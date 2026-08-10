import XCTest
@testable import NoSubVod

final class TwitchAuthManagerTests: XCTestCase {

    let testSuiteName = "com.theorhd.NoSubVodTests.TwitchAuth"
    var testDefaults: UserDefaults!
    var savedToken: String?

    override func setUp() {
        super.setUp()
        testDefaults = UserDefaults(suiteName: testSuiteName)
        testDefaults.removePersistentDomain(forName: testSuiteName)

        savedToken = UserDefaults.standard.string(forKey: "twitch_access_token")
        UserDefaults.standard.removeObject(forKey: "twitch_access_token")

        TwitchAuthManager.shared.accessToken = nil
        TwitchAuthManager.shared.isAuthenticated = false
    }

    override func tearDown() {
        if let token = savedToken {
            UserDefaults.standard.set(token, forKey: "twitch_access_token")
        } else {
            UserDefaults.standard.removeObject(forKey: "twitch_access_token")
        }
        testDefaults.removePersistentDomain(forName: testSuiteName)
        super.tearDown()
    }

    func testInitialState_notAuthenticatedWhenNoToken() {
        XCTAssertFalse(TwitchAuthManager.shared.isAuthenticated)
        XCTAssertNil(TwitchAuthManager.shared.currentUser)
        XCTAssertNil(TwitchAuthManager.shared.accessToken)
    }

    func testSetAccessToken_updatesAuthState() {
        TwitchAuthManager.shared.accessToken = "test-token-123"

        XCTAssertTrue(TwitchAuthManager.shared.isAuthenticated)
        XCTAssertEqual(TwitchAuthManager.shared.accessToken, "test-token-123")
        XCTAssertEqual(TwitchAPIService.shared.accessToken, "test-token-123")
    }

    func testSetAccessTokenToNil_clearsAuthState() {
        TwitchAuthManager.shared.accessToken = "test-token-456"
        XCTAssertTrue(TwitchAuthManager.shared.isAuthenticated)

        TwitchAuthManager.shared.accessToken = nil

        XCTAssertFalse(TwitchAuthManager.shared.isAuthenticated)
        XCTAssertNil(TwitchAuthManager.shared.accessToken)
        XCTAssertNil(TwitchAPIService.shared.accessToken)
        XCTAssertNil(TwitchAuthManager.shared.currentUser)
    }

    func testLogout_clearsToken() {
        TwitchAuthManager.shared.accessToken = "logout-token"
        XCTAssertTrue(TwitchAuthManager.shared.isAuthenticated)

        TwitchAuthManager.shared.logout()

        XCTAssertFalse(TwitchAuthManager.shared.isAuthenticated)
        XCTAssertNil(TwitchAuthManager.shared.accessToken)
    }
}
