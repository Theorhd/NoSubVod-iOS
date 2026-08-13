import Foundation
import SwiftData
import Combine
import CryptoKit
import os

enum TwitchAuthError: Error {
    case invalidURL
    case canceled
    case stateMismatch
    case missingCode
    case missingCallback
    case notAuthenticated
    case session(Error)
    case invalidResponse
}

/// Logs du flux OAuth — os.Logger (category: Auth) avec masquage .private des données sensibles.
enum TwitchAuthDebug {
    static func log(_ message: String, sensitive: String? = nil) {
        if let sensitive = sensitive {
            Logger.auth.debug("🟣 TwitchAuth: \(message, privacy: .public) \(sensitive, privacy: .private)")
        } else {
            Logger.auth.debug("🟣 TwitchAuth: \(message, privacy: .public)")
        }
    }
}

/// Gère la session Twitch : login OAuth (Authorization Code + PKCE), refresh
/// du token, import des suivis dans « Your Subs », logout.
///
/// Les tokens vivent dans le Keychain (via `TokenStore`) — plus jamais en
/// UserDefaults. `currentUser` (données publiques) est persisté en JSON.
///
/// La classe n'est pas isolée @MainActor (le chat IRC la lit depuis son thread
/// socket) ; les mutations d'état et le flux OAuth passent par le main thread
/// (`ASWebAuthenticationSession` l'exige).
final class TwitchAuthManager: ObservableObject {
    static let shared = TwitchAuthManager()

    @Published var isAuthenticated: Bool = false
    @Published var currentUser: TwitchUser?

    private let tokenStore: TokenStore
    private let accessTokenKey = "twitch_access_token"
    private let refreshTokenKey = "twitch_refresh_token"
    private let currentUserKey = "twitch_current_user"

    private var _accessToken: String?

    var accessToken: String? {
        get { _accessToken }
        set {
            _accessToken = newValue
            TwitchAPIService.shared.accessToken = newValue
            if let token = newValue {
                tokenStore.save(token, for: accessTokenKey)
                isAuthenticated = true
            } else {
                tokenStore.delete(for: accessTokenKey)
                isAuthenticated = false
                currentUser = nil
                UserDefaults.standard.removeObject(forKey: currentUserKey)
            }
        }
    }

    private var refreshToken: String? {
        get { tokenStore.read(for: refreshTokenKey) }
        set {
            if let token = newValue {
                tokenStore.save(token, for: refreshTokenKey)
            } else {
                tokenStore.delete(for: refreshTokenKey)
            }
        }
    }

    init(tokenStore: TokenStore = KeychainTokenStore.shared) {
        self.tokenStore = tokenStore
        migrateLegacyTokenIfNeeded()
        if let token = tokenStore.read(for: accessTokenKey) {
            _accessToken = token
            TwitchAPIService.shared.accessToken = token
            isAuthenticated = true
            if let data = UserDefaults.standard.data(forKey: currentUserKey),
               let user = try? Self.iso8601Decoder().decode(TwitchUser.self, from: data) {
                currentUser = user
            }
        }
    }

    // MARK: - Login (Authorization Code + PKCE)

    /// Une session de login en cours : URL d'autorisation à charger dans la
    /// webview + secrets PKCE/state pour finaliser l'échange.
    struct TwitchLoginSession {
        let authURL: URL
        let codeVerifier: String
        let state: String
    }

    /// Prépare le login : génère le code verifier/challenge PKCE et l'URL
    /// d'autorisation. La redirection vers le redirect URI (http://localhost,
    /// seule forme acceptée par Twitch) est interceptée par la webview de
    /// `TwitchLoginSheet` — aucune connexion vers localhost n'est nécessaire.
    func beginLogin() throws -> TwitchLoginSession {
        guard let redirectURI = URL(string: AppSecrets.twitchRedirectURI) else {
            throw TwitchAuthError.invalidURL
        }

        let verifier = Self.makeCodeVerifier()
        let challenge = Self.makeCodeChallenge(verifier: verifier)
        let state = UUID().uuidString

        var components = URLComponents(string: "https://id.twitch.tv/oauth2/authorize")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: AppSecrets.twitchClientId),
            URLQueryItem(name: "redirect_uri", value: redirectURI.absoluteString),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "user:read:follows chat:read chat:edit"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        guard let authURL = components.url else {
            throw TwitchAuthError.invalidURL
        }

        return TwitchLoginSession(authURL: authURL, codeVerifier: verifier, state: state)
    }

    /// Finalise le login avec l'URL de callback interceptée : vérifie le state,
    /// échange le code contre des tokens, récupère l'utilisateur courant.
    @MainActor
    func completeLogin(callbackURL: URL, session: TwitchLoginSession) async throws {
        TwitchAuthDebug.log("completeLogin: verifier=", sensitive: session.codeVerifier)
        guard callbackURL.queryValue("state") == session.state else {
            throw TwitchAuthError.stateMismatch
        }
        guard let code = callbackURL.queryValue("code") else {
            throw TwitchAuthError.missingCode
        }

        let tokens = try await exchangeCode(code: code, verifier: session.codeVerifier)
        accessToken = tokens.accessToken
        if let refresh = tokens.refreshToken {
            refreshToken = refresh
        }

        let user = try await TwitchAPIService.shared.fetchCurrentUser()
        currentUser = user
        persistCurrentUser(user)
        Logger.auth.info("🟣 TwitchAuth: connecté en tant que \(user.displayName, privacy: .private) (\(user.login, privacy: .private))")
    }

    // MARK: - Refresh

    /// Rafraîchit le token s'il expire dans moins d'une minute.
    /// Les access tokens Twitch expirent (~4 h) ; le refresh token (~30 j)
    /// est échangé silencieusement. Échec → logout (session invalide).
    @MainActor
    func refreshTokenIfNeeded() async {
        guard isAuthenticated, let token = accessToken else { return }
        guard let expiry = Self.jwtExpiry(token) else { return }
        guard expiry.timeIntervalSinceNow < 60 else { return }
        AppLogger.shared.log("🟣 TwitchAuth: refresh du token (expire dans \(Int(expiry.timeIntervalSinceNow)) s)")
        await performTokenRefresh()
    }

    @MainActor
    func performTokenRefresh() async {
        guard let refresh = refreshToken else {
            logout()
            return
        }

        guard let url = URLComponents(string: "https://id.twitch.tv/oauth2/token") else {
            return
        }
        var components = url
        components.queryItems = [
            URLQueryItem(name: "grant_type", value: "refresh_token"),
            URLQueryItem(name: "refresh_token", value: refresh),
            URLQueryItem(name: "client_id", value: AppSecrets.twitchClientId),
        ]
        guard let requestURL = components.url else { return }

        var request = URLRequest(url: requestURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = components.query?.data(using: .utf8)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                throw TwitchAuthError.invalidResponse
            }
            let tokens = try Self.iso8601Decoder().decode(TokenResponse.self, from: data)
            accessToken = tokens.accessToken
            if let refresh = tokens.refreshToken {
                refreshToken = refresh
            }
            AppLogger.shared.log("🟣 TwitchAuth: token rafraîchi")
        } catch {
            AppLogger.shared.log("🟣 TwitchAuth: refresh échoué — déconnexion")
            logout()
        }
    }

    // MARK: - Suivis (« Your Subs »)

    /// Importe les chaînes suivies du compte dans `PersistentSubscription`
    /// (dédup par login — la liste locale garde le contrôle utilisateur).
    @MainActor
    func syncFollows(into modelContext: ModelContext) async throws {
        guard let user = currentUser else {
            throw TwitchAuthError.notAuthenticated
        }
        await refreshTokenIfNeeded()

        let followed = try await TwitchAPIService.shared.fetchFollowedChannels(userID: user.id)

        let descriptor = FetchDescriptor<PersistentSubscription>()
        let existing = (try? modelContext.fetch(descriptor)) ?? []
        let existingLogins = Set(existing.map { $0.login.lowercased() })

        var imported = 0
        for channel in followed {
            let login = channel.broadcasterLogin.lowercased()
            guard !existingLogins.contains(login) else { continue }
            let sub = PersistentSubscription(
                login: login,
                displayName: channel.broadcasterName,
                profileImageURL: channel.profileImageURL,
                addedAt: channel.followedAt
            )
            modelContext.insert(sub)
            imported += 1
        }
        if imported > 0 {
            try modelContext.save()
        }
        AppLogger.shared.log("🟣 TwitchAuth: \(imported) suivis importés (\(followed.count) au total)")
    }

    // MARK: - Logout

    func logout() {
        let token = _accessToken
        accessToken = nil
        refreshToken = nil
        if let token {
            // Best-effort : révoque le token côté Twitch, sans bloquer l'UI.
            Task { await revoke(token: token) }
        }
        AppLogger.shared.log("🟣 TwitchAuth: déconnecté")
    }

    // MARK: - Échange de code

    private func exchangeCode(code: String, verifier: String) async throws -> TokenResponse {
        guard let url = URLComponents(string: "https://id.twitch.tv/oauth2/token") else {
            throw TwitchAuthError.invalidURL
        }
        var components = url
        components.queryItems = [
            URLQueryItem(name: "client_id", value: AppSecrets.twitchClientId),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "code_verifier", value: verifier),
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "redirect_uri", value: AppSecrets.twitchRedirectURI),
        ]
        // Client Confidential : Twitch exige le secret à l'échange de code.
        // Client Public : laisser vide (flux PKCE pur, aucun secret embarqué).
        if !AppSecrets.twitchClientSecret.isEmpty {
            components.queryItems?.append(URLQueryItem(name: "client_secret", value: AppSecrets.twitchClientSecret))
        }
        guard let requestURL = components.url, let body = components.query else {
            throw TwitchAuthError.invalidURL
        }

        TwitchAuthDebug.log("échange: POST \(requestURL.absoluteString)", sensitive: "body: \(body)")

        var request = URLRequest(url: requestURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = body.data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw TwitchAuthError.invalidResponse
        }
        if http.statusCode != 200 {
            let errorText = String(data: data, encoding: .utf8) ?? ""
            TwitchAuthDebug.log("échange de code échoué (\(http.statusCode))", sensitive: errorText)
            throw TwitchAuthError.invalidResponse
        }
        return try Self.iso8601Decoder().decode(TokenResponse.self, from: data)
    }

    private func revoke(token: String) async {
        guard let url = URLComponents(string: "https://id.twitch.tv/oauth2/revoke") else { return }
        var components = url
        components.queryItems = [
            URLQueryItem(name: "client_id", value: AppSecrets.twitchClientId),
            URLQueryItem(name: "token", value: token),
        ]
        guard let requestURL = components.url else { return }

        var request = URLRequest(url: requestURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = components.query?.data(using: .utf8)
        _ = try? await URLSession.shared.data(for: request)
    }

    // MARK: - Persistance

    private func persistCurrentUser(_ user: TwitchUser) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(user) {
            UserDefaults.standard.set(data, forKey: currentUserKey)
        }
    }

    /// Migration one-shot : l'ancien token UserDefaults (pre-1.2.0) part en Keychain.
    private func migrateLegacyTokenIfNeeded() {
        guard let legacy = UserDefaults.standard.string(forKey: "twitch_access_token") else { return }
        if tokenStore.read(for: accessTokenKey) == nil {
            tokenStore.save(legacy, for: accessTokenKey)
        }
        UserDefaults.standard.removeObject(forKey: "twitch_access_token")
    }

    // MARK: - PKCE / JWT (statiques, testables)

    /// Code verifier OAuth (RFC 7636) : 64 chars du set `[A-Za-z0-9-._~]`.
    static func makeCodeVerifier() -> String {
        let alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"
        return String((0..<64).compactMap { _ in alphabet.randomElement() })
    }

    /// Challenge S256 du code verifier, encodé base64url sans padding.
    static func makeCodeChallenge(verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return Data(digest)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Date d'expiration d'un access token JWT (champ `exp` du payload).
    /// nil si le token n'est pas un JWT exploitable.
    static func jwtExpiry(_ token: String) -> Date? {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var b64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = json["exp"] as? Double else {
            return nil
        }
        return Date(timeIntervalSince1970: exp)
    }

    private static func iso8601Decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

private struct TokenResponse: Codable {
    let accessToken: String
    let refreshToken: String?
    let expiresIn: Int?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
    }
}

private extension URL {
    func queryValue(_ name: String) -> String? {
        URLComponents(url: self, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first { $0.name == name }?
            .value
    }
}
