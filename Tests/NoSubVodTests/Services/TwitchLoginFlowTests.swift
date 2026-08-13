import XCTest
@testable import NoSubVod

final class TwitchLoginFlowTests: XCTestCase {

    override func setUp() {
        super.setUp()
        TwitchAPIService.shared.accessToken = nil
    }

    private func queryValue(of url: URL, _ name: String) -> String? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first { $0.name == name }?
            .value
    }

    // MARK: - beginLogin

    func testBeginLogin_buildsAuthorizeURLWithPKCE() throws {
        let session = try TwitchAuthManager().beginLogin()
        let url = session.authURL

        XCTAssertEqual(url.scheme, "https")
        XCTAssertEqual(url.host, "id.twitch.tv")
        XCTAssertEqual(queryValue(of: url, "response_type"), "code")
        XCTAssertEqual(queryValue(of: url, "code_challenge_method"), "S256")
        XCTAssertEqual(queryValue(of: url, "state"), session.state)
        XCTAssertEqual(queryValue(of: url, "redirect_uri"), AppSecrets.twitchRedirectURI)
        XCTAssertEqual(queryValue(of: url, "scope"), "user:read:follows chat:read chat:edit")

        // Le challenge doit correspondre au S256 du verifier de la session.
        let challenge = try XCTUnwrap(queryValue(of: url, "code_challenge"))
        XCTAssertEqual(challenge, TwitchAuthManager.makeCodeChallenge(verifier: session.codeVerifier))
        XCTAssertEqual(session.codeVerifier.count, 64)
    }

    // MARK: - completeLogin

    @MainActor
    func testCompleteLogin_rejectsMismatchedState() async throws {
        let manager = TwitchAuthManager(tokenStore: InMemoryTokenStore())
        let session = try manager.beginLogin()
        let callbackURL = URL(string: "http://localhost:8142/oauth/callback?code=abc&state=wrong-state")!

        do {
            try await manager.completeLogin(callbackURL: callbackURL, session: session)
            XCTFail("Devrait lever TwitchAuthError.stateMismatch")
        } catch TwitchAuthError.stateMismatch {
            // Attendu.
        } catch {
            XCTFail("Mauvaise erreur : \(error)")
        }
        XCTAssertNil(manager.accessToken)
        XCTAssertFalse(manager.isAuthenticated)
    }

    @MainActor
    func testCompleteLogin_rejectsMissingCode() async throws {
        let manager = TwitchAuthManager(tokenStore: InMemoryTokenStore())
        let session = try manager.beginLogin()
        let callbackURL = URL(string: "http://localhost:8142/oauth/callback?state=\(session.state)")!

        do {
            try await manager.completeLogin(callbackURL: callbackURL, session: session)
            XCTFail("Devrait lever TwitchAuthError.missingCode")
        } catch TwitchAuthError.missingCode {
            // Attendu.
        } catch {
            XCTFail("Mauvaise erreur : \(error)")
        }
    }
}
