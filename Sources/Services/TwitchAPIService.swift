import Foundation

enum TwitchAPIError: Error {
    case invalidURL
    case invalidResponse
    case decodingError(Error)
    case requestFailed(Error)
    case unauthorized
}

class TwitchAPIService {
    static let shared = TwitchAPIService()

    private let helixBaseURL = "https://api.twitch.tv/helix"
    private let gqlBaseURL   = "https://gql.twitch.tv/gql"

    var accessToken: String?
    var clientId: String = "kimne78kx3ncx6brgo4mv6wki5h1ko"


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

    /// Injected URLSession for testability. Defaults to .shared.
    var urlSession: URLSession = .shared

    private init() {}


    func fetchUser(login: String) async throws -> TwitchUser {
        guard let url = URL(string: "\(helixBaseURL)/users?login=\(login)") else {
            throw TwitchAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if let token = accessToken {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.addValue(clientId, forHTTPHeaderField: "Client-Id")

        let (data, response) = try await urlSession.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw TwitchAPIError.invalidResponse
        }

        let decoder = JSONDecoder()
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
            print("GQL ERROR: invalidURL")
            throw TwitchAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        if let token = accessToken {
            request.addValue("OAuth \(token)", forHTTPHeaderField: "Authorization")
        }
        request.addValue("kimne78kx3ncx6brgo4mv6wki5h1ko", forHTTPHeaderField: "Client-Id")
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "query": query,
            "variables": variables
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await urlSession.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            print("GQL ERROR: Not HTTPURLResponse")
            throw TwitchAPIError.invalidResponse
        }

        if httpResponse.statusCode != 200 {
            print("GQL ERROR: statusCode = \(httpResponse.statusCode), body = \(String(data: data, encoding: .utf8) ?? "")")
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
