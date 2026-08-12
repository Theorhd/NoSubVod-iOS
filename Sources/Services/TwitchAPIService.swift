import Foundation

enum TwitchAPIError: Error {
    case invalidURL
    case invalidResponse
    case decodingError(Error)
    case requestFailed(Error)
    case unauthorized
}

final class TwitchAPIService {
    static let shared = TwitchAPIService()

    private let helixBaseURL = "https://api.twitch.tv/helix"
    private let gqlBaseURL   = "https://gql.twitch.tv/gql"

    var accessToken: String?

    /// Client ID du web Twitch — utilisé en permanence pour la lecture
    /// (GQL et usher VOD/live), jamais remplacé par l'app OAuth.
    let webClientId: String = "kimne78kx3ncx6brgo4mv6wki5h1ko"

    /// Client ID de l'app OAuth, injecté au build depuis .env (voir
    /// scripts/generate_secrets.sh). Réservé au flux OAuth et aux endpoints
    /// Helix authentifiés (follows, current user). Si vide (tests, build sans
    /// .env), on retombe sur le web client ID.
    let clientId: String = AppSecrets.twitchClientId.isEmpty
        ? "kimne78kx3ncx6brgo4mv6wki5h1ko"
        : AppSecrets.twitchClientId


    private struct CacheEntry {
        let data: Data
        let expiry: Date
    }
    /// Cache in-memory des réponses GQL, clé = hash(query).
    /// TTL de 60s — assez court pour du live, assez long pour éviter les requêtes en rafale.
    private var gqlCache: [Int: CacheEntry] = [:]
    private let gqlCacheTTL: TimeInterval = 60

    /// Date du dernier appel à fetchLiveStatus — throttle à 30s minimum.
    private var lastLiveStatusFetch: Date = .distantPast
    private let liveStatusThrottle: TimeInterval = 30

    var urlSession: URLSession = .shared

    private init() {}


    func fetchUser(login: String) async throws -> TwitchUser {
        guard let url = URL(string: "\(helixBaseURL)/users?login=\(login)") else {
            throw TwitchAPIError.invalidURL
        }

        let (data, response) = try await urlSession.data(for: helixRequest(url: url))
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw TwitchAPIError.invalidResponse
        }
        return try decodeUser(from: data)
    }

    /// Renvoie le propriétaire du token actuel (Helix /users sans paramètre).
    func fetchCurrentUser() async throws -> TwitchUser {
        guard accessToken != nil else {
            throw TwitchAPIError.unauthorized
        }
        guard let url = URL(string: "\(helixBaseURL)/users") else {
            throw TwitchAPIError.invalidURL
        }

        let (data, response) = try await urlSession.data(for: helixRequest(url: url))
        guard let httpResponse = response as? HTTPURLResponse else {
            throw TwitchAPIError.invalidResponse
        }
        if httpResponse.statusCode == 401 {
            throw TwitchAPIError.unauthorized
        }
        guard httpResponse.statusCode == 200 else {
            throw TwitchAPIError.invalidResponse
        }
        return try decodeUser(from: data)
    }

    /// Chaîne suivie par un utilisateur (Helix /channels/followed, paginé).
    /// `profileImageURL` est complété via /users (l'endpoint follows ne le renvoie pas).
    struct FollowedChannel: Codable, Hashable {
        let broadcasterID: String
        let broadcasterLogin: String
        let broadcasterName: String
        let followedAt: Date
        var profileImageURL: URL?

        enum CodingKeys: String, CodingKey {
            case broadcasterID = "broadcaster_id"
            case broadcasterLogin = "broadcaster_login"
            case broadcasterName = "broadcaster_name"
            case followedAt = "followed_at"
        }
    }

    /// Récupère toutes les chaînes suivies par `userID` (pagination curseur),
    /// puis complète avec les profils (avatars) via /users par lots de 100.
    func fetchFollowedChannels(userID: String) async throws -> [FollowedChannel] {
        guard accessToken != nil else {
            throw TwitchAPIError.unauthorized
        }

        var all: [FollowedChannel] = []
        var cursor: String?

        repeat {
            var components = URLComponents(string: "\(helixBaseURL)/channels/followed")!
            components.queryItems = [
                URLQueryItem(name: "user_id", value: userID),
                URLQueryItem(name: "first", value: "100"),
            ]
            if let cursor {
                components.queryItems?.append(URLQueryItem(name: "after", value: cursor))
            }

            guard let url = components.url else {
                throw TwitchAPIError.invalidURL
            }
            let (data, response) = try await urlSession.data(for: helixRequest(url: url))
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                throw TwitchAPIError.invalidResponse
            }

            struct FollowedResponse: Codable {
                struct Pagination: Codable { let cursor: String? }
                let data: [FollowedChannel]
                let pagination: Pagination
            }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let result = try decoder.decode(FollowedResponse.self, from: data)
            all.append(contentsOf: result.data)
            cursor = result.pagination.cursor
        } while cursor != nil

        // Complète avec les avatars (le endpoint follows n'expose pas d'image).
        // /users accepte 100 IDs max par requête → découpage en lots.
        let allIDs = all.map(\.broadcasterID)
        let idChunks = stride(from: 0, to: allIDs.count, by: 100).map {
            Array(allIDs[$0..<min($0 + 100, allIDs.count)])
        }
        var profilesByID: [String: URL?] = [:]
        for chunk in idChunks {
            let profiles = try await fetchProfiles(for: chunk)
            for profile in profiles {
                profilesByID[profile.id] = profile.profileImageURL
            }
        }
        return all.map { followed in
            var copy = followed
            copy.profileImageURL = profilesByID[followed.broadcasterID] ?? nil
            return copy
        }
    }

    /// Profils Helix /users (avatars, display names) — max 100 IDs par requête.
    func fetchProfiles(for ids: [String]) async throws -> [TwitchUser] {
        guard !ids.isEmpty, ids.count <= 100 else {
            throw TwitchAPIError.invalidResponse
        }
        var components = URLComponents(string: "\(helixBaseURL)/users")!
        components.queryItems = ids.map { URLQueryItem(name: "id", value: $0) }

        guard let url = components.url else {
            throw TwitchAPIError.invalidURL
        }
        let (data, response) = try await urlSession.data(for: helixRequest(url: url))
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw TwitchAPIError.invalidResponse
        }

        struct UserResponse: Codable {
            let data: [TwitchUser]
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            let result = try decoder.decode(UserResponse.self, from: data)
            return result.data
        } catch {
            throw TwitchAPIError.decodingError(error)
        }
    }

    /// Requête Helix de base : Authorization Bearer + Client-Id.
    private func helixRequest(url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if let token = accessToken {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.addValue(clientId, forHTTPHeaderField: "Client-Id")
        return request
    }

    private func decodeUser(from data: Data) throws -> TwitchUser {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        struct UserResponse: Codable {
            let data: [TwitchUser]
        }

        do {
            let result = try decoder.decode(UserResponse.self, from: data)
            guard let user = result.data.first else {
                throw TwitchAPIError.invalidResponse
            }
            return user
        } catch {
            throw TwitchAPIError.decodingError(error)
        }
    }


    func executeGQLQuery(query: String, variables: [String: Any]) async throws -> Data {
        let cacheKey = query.hashValue &+ variables.description.hashValue
        if let entry = gqlCache[cacheKey], entry.expiry > Date() {
            return entry.data
        }

        guard let url = URL(string: gqlBaseURL) else {
            AppLogger.shared.log("GQL ERROR: invalidURL")
            throw TwitchAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        // Lecture GQL anonyme via le web client ID : on n'attache JAMAIS le
        // token utilisateur ici — un token émis par notre app OAuth avec le
        // header Client-Id du web client fait rejeter la requête par
        // gql.twitch.tv (émetteur ≠ header). Le token ne sert qu'à Helix
        // (follows, profil) et au chat IRC.
        request.addValue(webClientId, forHTTPHeaderField: "Client-Id")
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "query": query,
            "variables": variables
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await urlSession.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            AppLogger.shared.log("GQL ERROR: Not HTTPURLResponse")
            throw TwitchAPIError.invalidResponse
        }

        if httpResponse.statusCode != 200 {
            AppLogger.shared.log("GQL ERROR: statusCode = \(httpResponse.statusCode), body = \(String(data: data, encoding: .utf8) ?? "")")
            throw TwitchAPIError.invalidResponse
        }

        gqlCache[cacheKey] = CacheEntry(data: data, expiry: Date().addingTimeInterval(gqlCacheTTL))

        return data
    }

    /// Invalide l'intégralité du cache GQL (utile lors d'un pull-to-refresh explicite).
    func invalidateGQLCache() {
        gqlCache.removeAll()
    }


    /// Retourne true si le throttle n'est pas encore expiré (appel trop récent).
    func shouldSkipLiveStatusFetch() -> Bool {
        Date().timeIntervalSince(lastLiveStatusFetch) < liveStatusThrottle
    }

    func markLiveStatusFetched() {
        lastLiveStatusFetch = Date()
    }
}
