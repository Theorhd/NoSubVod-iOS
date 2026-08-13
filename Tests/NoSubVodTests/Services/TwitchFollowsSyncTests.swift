import XCTest
import SwiftData
@testable import NoSubVod

final class TwitchFollowsSyncTests: XCTestCase {

    private var manager: TwitchAuthManager!
    private var container: ModelContainer!
    private var savedURLSession: URLSession!
    private var savedAPIToken: String?

    override func setUp() {
        super.setUp()
        MockURLProtocol.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        savedURLSession = TwitchAPIService.shared.urlSession
        TwitchAPIService.shared.urlSession = URLSession(configuration: config)
        savedAPIToken = TwitchAPIService.shared.accessToken

        container = ModelContainerHelper.createTestContainer()
        manager = TwitchAuthManager(tokenStore: InMemoryTokenStore())
        manager.accessToken = "test-token"
        manager.currentUser = TwitchUser(id: "123", login: "me", displayName: "Me", profileImageURL: nil, createdAt: nil)
    }

    override func tearDown() {
        MockURLProtocol.reset()
        TwitchAPIService.shared.urlSession = savedURLSession
        TwitchAPIService.shared.accessToken = savedAPIToken
        super.tearDown()
    }

    @MainActor
    private func fetchSubs() throws -> [PersistentSubscription] {
        try container.mainContext.fetch(FetchDescriptor<PersistentSubscription>())
    }

    private func registerFollowsPage1() {
        MockURLProtocol.registerJSON(
            url: URL(string: "https://api.twitch.tv/helix/channels/followed?user_id=123&first=100")!,
            jsonString: """
            {"data":[
              {"broadcaster_id":"111","broadcaster_login":"xqc","broadcaster_name":"xQc","followed_at":"2024-01-02T10:00:00Z"},
              {"broadcaster_id":"222","broadcaster_login":"zerator","broadcaster_name":"Zerator","followed_at":"2024-03-04T11:00:00Z"}
            ],"pagination":{"cursor":"abc"}}
            """
        )
    }

    private func registerFollowsPage2() {
        MockURLProtocol.registerJSON(
            url: URL(string: "https://api.twitch.tv/helix/channels/followed?user_id=123&first=100&after=abc")!,
            jsonString: """
            {"data":[
              {"broadcaster_id":"333","broadcaster_login":"mistermv","broadcaster_name":"MisterMV","followed_at":"2024-05-06T12:00:00Z"}
            ],"pagination":{"cursor":null}}
            """
        )
    }

    private func registerProfiles() {
        MockURLProtocol.registerJSON(
            url: URL(string: "https://api.twitch.tv/helix/users?id=111&id=222&id=333")!,
            jsonString: """
            {"data":[
              {"id":"111","login":"xqc","display_name":"xQc","profile_image_url":"https://cdn.example/xqc.png","created_at":"2016-01-01T00:00:00Z"},
              {"id":"222","login":"zerator","display_name":"Zerator","profile_image_url":"https://cdn.example/zerator.png","created_at":"2012-01-01T00:00:00Z"},
              {"id":"333","login":"mistermv","display_name":"MisterMV","profile_image_url":"https://cdn.example/mistermv.png","created_at":"2015-01-01T00:00:00Z"}
            ]}
            """
        )
    }

    private func registerAll() {
        registerFollowsPage1()
        registerFollowsPage2()
        registerProfiles()
    }

    @MainActor
    func testSyncFollows_importsAllPagesWithAvatars() async throws {
        registerAll()

        try await manager.syncFollows(into: container.mainContext)

        let subs = try fetchSubs()
        XCTAssertEqual(subs.count, 3)

        let fmt = ISO8601DateFormatter()
        let xqc = try XCTUnwrap(subs.first { $0.login == "xqc" })
        XCTAssertEqual(xqc.displayName, "xQc")
        XCTAssertEqual(xqc.profileImageURL, URL(string: "https://cdn.example/xqc.png"))
        XCTAssertEqual(xqc.addedAt, fmt.date(from: "2024-01-02T10:00:00Z"))

        let zerator = try XCTUnwrap(subs.first { $0.login == "zerator" })
        XCTAssertEqual(zerator.displayName, "Zerator")
        XCTAssertEqual(zerator.addedAt, fmt.date(from: "2024-03-04T11:00:00Z"))

        let mistermv = try XCTUnwrap(subs.first { $0.login == "mistermv" })
        XCTAssertEqual(mistermv.profileImageURL, URL(string: "https://cdn.example/mistermv.png"))
        XCTAssertEqual(mistermv.addedAt, fmt.date(from: "2024-05-06T12:00:00Z"))
    }

    @MainActor
    func testSyncFollows_deduplicatesExistingLocalSubscriptions() async throws {
        // Abonnement local pré-existant — ne doit pas être dupliqué.
        let existing = PersistentSubscription(login: "xqc", displayName: "xQc", profileImageURL: nil, addedAt: Date())
        container.mainContext.insert(existing)
        try container.mainContext.save()

        registerAll()

        try await manager.syncFollows(into: container.mainContext)

        let subs = try fetchSubs()
        XCTAssertEqual(subs.count, 3)
        XCTAssertEqual(subs.filter { $0.login == "xqc" }.count, 1)
        // L'entrée locale existante est conservée telle quelle (pas écrasée).
        XCTAssertEqual(subs.first { $0.login == "xqc" }?.profileImageURL, nil)
    }

    @MainActor
    func testSyncFollows_requiresAuthenticatedUser() async throws {
        manager.accessToken = nil

        do {
            try await manager.syncFollows(into: container.mainContext)
            XCTFail("Devrait lever TwitchAuthError.notAuthenticated")
        } catch TwitchAuthError.notAuthenticated {
            // Attendu.
        } catch {
            XCTFail("Mauvaise erreur : \(error)")
        }
    }

    @MainActor
    func testSyncFollows_handlesEmptyFollows() async throws {
        MockURLProtocol.registerJSON(
            url: URL(string: "https://api.twitch.tv/helix/channels/followed?user_id=123&first=100")!,
            jsonString: #"{"data":[],"pagination":{"cursor":null}}"#
        )

        try await manager.syncFollows(into: container.mainContext)

        XCTAssertTrue(try fetchSubs().isEmpty)
    }
}
