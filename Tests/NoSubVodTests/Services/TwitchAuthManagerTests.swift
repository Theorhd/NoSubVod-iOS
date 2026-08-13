import XCTest
import CryptoKit
@testable import NoSubVod

final class TwitchAuthManagerTests: XCTestCase {

    private var store: InMemoryTokenStore!
    private var savedStandardToken: String?
    private var savedCurrentUser: Data?
    private var savedAPIToken: String?

    override func setUp() {
        super.setUp()
        store = InMemoryTokenStore()

        // Isolation des UserDefaults globaux (légacy + currentUser) et du
        // token de TwitchAPIService, restaurés en tearDown.
        savedStandardToken = UserDefaults.standard.string(forKey: "twitch_access_token")
        UserDefaults.standard.removeObject(forKey: "twitch_access_token")
        savedCurrentUser = UserDefaults.standard.data(forKey: "twitch_current_user")
        UserDefaults.standard.removeObject(forKey: "twitch_current_user")
        savedAPIToken = TwitchAPIService.shared.accessToken
        TwitchAPIService.shared.accessToken = nil
    }

    override func tearDown() {
        if let token = savedStandardToken {
            UserDefaults.standard.set(token, forKey: "twitch_access_token")
        } else {
            UserDefaults.standard.removeObject(forKey: "twitch_access_token")
        }
        if let data = savedCurrentUser {
            UserDefaults.standard.set(data, forKey: "twitch_current_user")
        } else {
            UserDefaults.standard.removeObject(forKey: "twitch_current_user")
        }
        TwitchAPIService.shared.accessToken = savedAPIToken
        super.tearDown()
    }

    private func makeManager() -> TwitchAuthManager {
        TwitchAuthManager(tokenStore: store)
    }

    // MARK: - État

    func testInitialState_notAuthenticatedWhenNoToken() {
        let manager = makeManager()
        XCTAssertFalse(manager.isAuthenticated)
        XCTAssertNil(manager.currentUser)
        XCTAssertNil(manager.accessToken)
    }

    func testSetAccessToken_updatesAuthState() {
        let manager = makeManager()
        manager.accessToken = "test-token-123"

        XCTAssertTrue(manager.isAuthenticated)
        XCTAssertEqual(manager.accessToken, "test-token-123")
        XCTAssertEqual(TwitchAPIService.shared.accessToken, "test-token-123")
        XCTAssertEqual(store.read(for: "twitch_access_token"), "test-token-123")
    }

    func testSetAccessTokenToNil_clearsAuthState() {
        let manager = makeManager()
        manager.accessToken = "test-token-456"
        XCTAssertTrue(manager.isAuthenticated)

        manager.accessToken = nil

        XCTAssertFalse(manager.isAuthenticated)
        XCTAssertNil(manager.accessToken)
        XCTAssertNil(TwitchAPIService.shared.accessToken)
        XCTAssertNil(manager.currentUser)
        XCTAssertNil(store.read(for: "twitch_access_token"))
    }

    func testLogout_clearsToken() {
        let manager = makeManager()
        manager.accessToken = "logout-token"
        XCTAssertTrue(manager.isAuthenticated)

        manager.logout()

        XCTAssertFalse(manager.isAuthenticated)
        XCTAssertNil(manager.accessToken)
        XCTAssertNil(store.read(for: "twitch_access_token"))
    }

    func testInit_restoresTokenFromStore() {
        store.save("persisted-token", for: "twitch_access_token")

        let manager = makeManager()

        XCTAssertTrue(manager.isAuthenticated)
        XCTAssertEqual(manager.accessToken, "persisted-token")
        XCTAssertEqual(TwitchAPIService.shared.accessToken, "persisted-token")
    }

    // MARK: - Migration UserDefaults → Keychain

    func testMigration_movesLegacyTokenFromUserDefaults() {
        UserDefaults.standard.set("legacy-token", forKey: "twitch_access_token")

        let manager = makeManager()

        XCTAssertEqual(manager.accessToken, "legacy-token")
        XCTAssertEqual(store.read(for: "twitch_access_token"), "legacy-token")
        XCTAssertNil(UserDefaults.standard.string(forKey: "twitch_access_token"))
    }

    func testMigration_keepsExistingTokenWhenAlreadyInStore() {
        store.save("keychain-token", for: "twitch_access_token")
        UserDefaults.standard.set("legacy-token", forKey: "twitch_access_token")

        let manager = makeManager()

        XCTAssertEqual(manager.accessToken, "keychain-token")
        XCTAssertNil(UserDefaults.standard.string(forKey: "twitch_access_token"))
    }

    // MARK: - PKCE

    func testMakeCodeVerifier_lengthAndCharset() {
        let verifier = TwitchAuthManager.makeCodeVerifier()
        XCTAssertEqual(verifier.count, 64)
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        XCTAssertTrue(verifier.unicodeScalars.allSatisfy { allowed.contains($0) })
    }

    func testMakeCodeVerifier_isRandom() {
        XCTAssertNotEqual(TwitchAuthManager.makeCodeVerifier(), TwitchAuthManager.makeCodeVerifier())
    }

    func testMakeCodeChallenge_matchesS256Base64URL() {
        let verifier = "some-verifier-123"
        let challenge = TwitchAuthManager.makeCodeChallenge(verifier: verifier)

        // Réimplémentation indépendante (CryptoKit direct) pour valider la transformation.
        let digest = SHA256.hash(data: Data(verifier.utf8))
        let expected = Data(digest)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")

        XCTAssertEqual(challenge, expected)
        XCTAssertFalse(challenge.contains("+"))
        XCTAssertFalse(challenge.contains("/"))
        XCTAssertFalse(challenge.contains("="))
    }

    // MARK: - JWT exp

    private func makeJWT(payload: [String: Any]) -> String {
        let encode = { (dict: [String: Any]) -> String in
            let data = try! JSONSerialization.data(withJSONObject: dict)
            return data.base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
        let header = encode(["alg": "none", "typ": "JWT"])
        let body = encode(payload)
        return "\(header).\(body).signature"
    }

    func testJwtExpiry_parsesPayloadExp() {
        let token = makeJWT(payload: ["exp": 2_000_000_000])
        XCTAssertEqual(TwitchAuthManager.jwtExpiry(token), Date(timeIntervalSince1970: 2_000_000_000))
    }

    func testJwtExpiry_notAJWT_returnsNil() {
        XCTAssertNil(TwitchAuthManager.jwtExpiry("plain-token"))
        XCTAssertNil(TwitchAuthManager.jwtExpiry("a.b"))
    }

    func testJwtExpiry_missingExp_returnsNil() {
        let token = makeJWT(payload: ["sub": "123"])
        XCTAssertNil(TwitchAuthManager.jwtExpiry(token))
    }
}
