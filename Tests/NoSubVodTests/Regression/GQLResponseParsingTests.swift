import XCTest
@testable import NoSubVod

/// Tests that validate JSON decoding of real Twitch GQL API responses using
/// the actual GQL* types defined in TwitchAPIService+GQL.swift.
/// Previously these tests defined duplicate inline Codable structs that could
/// diverge from the production code — they now test the real types directly.
final class GQLResponseParsingTests: XCTestCase {

    // MARK: - Live Streams

    func testDecodeLiveStreams_fromFixture() throws {
        let json = loadFixture("gql_live_streams")
        let response = try JSONDecoder().decode(GQLResponse.self, from: json)

        let edges = response.data?.streams?.edges ?? []
        XCTAssertEqual(edges.count, 2)

        let first = edges[0].node!
        XCTAssertEqual(first.id, "42080878076")
        XCTAssertEqual(first.viewersCount, 25120)
        XCTAssertEqual(first.broadcaster?.login, "kaicenat")
        XCTAssertEqual(first.game?.name, "Just Chatting")

        let second = edges[1].node!
        XCTAssertEqual(second.language, "fr")
        XCTAssertEqual(second.broadcaster?.displayName, "ZeratoR")
        XCTAssertEqual(second.game?.name, "Fortnite")
    }

    // MARK: - Channel VODs

    func testDecodeChannelVODs_fromFixture() throws {
        let json = loadFixture("gql_channel_vods")
        let response = try JSONDecoder().decode(GQLResponse.self, from: json)

        let edges = response.data?.user?.videos?.edges ?? []
        XCTAssertEqual(edges.count, 2)

        let firstNode = edges[0].node!
        XCTAssertEqual(firstNode.id, "2170531517")
        XCTAssertEqual(firstNode.broadcastType, "HIGHLIGHT")
        XCTAssertEqual(firstNode.lengthSeconds, 12360)
        XCTAssertEqual(firstNode.viewCount, 1542000)

        let secondNode = edges[1].node!
        XCTAssertEqual(secondNode.broadcastType, "ARCHIVE")
        XCTAssertEqual(secondNode.owner?.login, "kaicenat")
    }

    // MARK: - Search

    func testDecodeSearch_fromFixture() throws {
        let json = loadFixture("gql_search")
        let response = try JSONDecoder().decode(GQLResponse.self, from: json)

        XCTAssertEqual(response.data?.game?.name, "Just Chatting")
        let channels = response.data?.searchFor?.channels?.edges ?? []
        XCTAssertEqual(channels.count, 1)
        XCTAssertEqual(channels[0].item?.login, "zerator")
        XCTAssertEqual(channels[0].item?.stream?.language, "fr")
    }

    // MARK: - Category Details

    func testDecodeCategoryDetails_fromFixture() throws {
        let json = loadFixture("gql_category_details")
        let response = try JSONDecoder().decode(GQLResponse.self, from: json)

        XCTAssertNotNil(response.data?.game)
        XCTAssertEqual(response.data?.game?.streams?.edges?.count, 1)
        XCTAssertEqual(response.data?.game?.videos?.edges?.count, 1)
        XCTAssertEqual(response.data?.game?.clips?.edges?.count, 1)

        let clip = response.data?.game?.clips?.edges?[0].node
        XCTAssertEqual(clip?.durationSeconds, 30)
        XCTAssertEqual(clip?.viewCount, 50000)
    }

    /// Regression: `videos(sort: TRENDING)` n'est pas une valeur valide de
    /// l'enum VideoSort — Twitch rejette toute la requête (HTTP 200 + errors),
    /// ce qui affichait la catégorie sans aucun contenu. Le sort doit être
    /// une valeur valide (VIEWS) et la réponse doit se parser en streams/VODs/clips.
    @MainActor
    func testFetchCategoryDetails_sendsValidVideoSort() async throws {
        MockURLProtocol.reset()
        MockURLProtocol.registerJSON(
            url: URL(string: "https://gql.twitch.tv/gql")!,
            jsonString: String(data: loadFixture("gql_category_details"), encoding: .utf8)!
        )
        TwitchAPIService.shared.invalidateGQLCache()

        let savedSession = TwitchAPIService.shared.urlSession
        defer { TwitchAPIService.shared.urlSession = savedSession }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        TwitchAPIService.shared.urlSession = URLSession(configuration: config)

        let result = try await TwitchAPIService.shared.fetchCategoryDetails(gameName: "Just Chatting")

        XCTAssertEqual(result.lives.count, 1)
        XCTAssertEqual(result.vods.count, 1)
        XCTAssertEqual(result.clips.count, 1)

        let body = try XCTUnwrap(MockURLProtocol.lastRequestBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        let query = try XCTUnwrap(json["query"] as? String)
        XCTAssertTrue(query.contains("sort: VIEWS"), "le sort des videos doit être une valeur valide de VideoSort")
        XCTAssertFalse(query.contains("TRENDING"), "TRENDING n'existe pas dans l'enum VideoSort de Twitch")
    }

    // MARK: - User Live Stream (section "Now Live" de ChannelView)

    /// user.stream doit se parser en LiveStream complet — il alimente la
    /// section "Now Live" de ChannelView (badge LIVE sur la miniature).
    @MainActor
    func testFetchLiveStream_mapsUserStream() async throws {
        MockURLProtocol.reset()
        MockURLProtocol.registerJSON(
            url: URL(string: "https://gql.twitch.tv/gql")!,
            jsonString: String(data: loadFixture("gql_user_stream"), encoding: .utf8)!
        )
        TwitchAPIService.shared.invalidateGQLCache()

        let savedSession = TwitchAPIService.shared.urlSession
        defer { TwitchAPIService.shared.urlSession = savedSession }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        TwitchAPIService.shared.urlSession = URLSession(configuration: config)

        let stream = try await TwitchAPIService.shared.fetchLiveStream(login: "kaicenat")

        let live = try XCTUnwrap(stream, "le streamer est en live dans le fixture")
        XCTAssertEqual(live.broadcaster.login, "kaicenat")
        XCTAssertEqual(live.broadcaster.displayName, "KaiCenat")
        XCTAssertEqual(live.title, "BIG SUBATHON DAY 30")
        XCTAssertEqual(live.viewerCount, 25120)
        XCTAssertEqual(live.game?.name, "Just Chatting")
        XCTAssertEqual(live.previewImageURL, URL(string: "https://static-cdn.jtvnw.net/previews-ttv/live_user_kaicenat-640x360.jpg"))
    }

    // MARK: - Cache GQL (crash de concurrence)

    /// Regression: le cache GQL était un Dictionary non-verrouillé à clés Int
    /// (hashValue) — les TaskGroups concurrents (Home, Channel) le mutaient en
    /// course et l'app crashait en SIGSEGV (`setValue(_:forKey:)` / bridging
    /// KVC). Le cache doit supporter 20 requêtes simultanées sans crash.
    /// Non-isolé volontairement : sur le MainActor les écritures seraient
    /// sérialisées et le test ne détecterait pas la course.
    func testExecuteGQLQuery_concurrentAccessDoesNotCrash() async throws {
        MockURLProtocol.reset()
        MockURLProtocol.registerJSON(
            url: URL(string: "https://gql.twitch.tv/gql")!,
            jsonString: String(data: loadFixture("gql_search"), encoding: .utf8)!
        )
        TwitchAPIService.shared.invalidateGQLCache()

        let savedSession = TwitchAPIService.shared.urlSession
        defer { TwitchAPIService.shared.urlSession = savedSession }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        TwitchAPIService.shared.urlSession = URLSession(configuration: config)

        // 20 requêtes différentes en parallèle → 20 écritures concurrentes
        // dans le cache. Le même pattern que fetchTrendingVODs (TaskGroup).
        let queries = (0..<20).map { idx in
            "query { game(name: \"game\(idx)\") { id name } }"
        }
        try await withThrowingTaskGroup(of: Void.self) { group in
            for query in queries {
                group.addTask {
                    _ = try await TwitchAPIService.shared.executeGQLQuery(query: query, variables: [:])
                }
            }
            try await group.waitForAll()
        }

        // Les réponses sont en cache — vérifier qu'elles se relisent sans crash.
        for query in queries {
            let data = try await TwitchAPIService.shared.executeGQLQuery(query: query, variables: [:])
            XCTAssertFalse(data.isEmpty)
        }
    }

    // MARK: - Popular Categories (section "Popular Categories" de SearchView)

    @MainActor
    func testFetchPopularGames_mapsTopGames() async throws {
        MockURLProtocol.reset()
        MockURLProtocol.registerJSON(
            url: URL(string: "https://gql.twitch.tv/gql")!,
            jsonString: String(data: loadFixture("gql_popular_games"), encoding: .utf8)!
        )
        TwitchAPIService.shared.invalidateGQLCache()

        let savedSession = TwitchAPIService.shared.urlSession
        defer { TwitchAPIService.shared.urlSession = savedSession }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        TwitchAPIService.shared.urlSession = URLSession(configuration: config)

        let games = try await TwitchAPIService.shared.fetchPopularGames(limit: 3)

        XCTAssertEqual(games.count, 3)
        XCTAssertEqual(games[0].name, "Just Chatting")
        XCTAssertEqual(games[0].id, "509658")
        XCTAssertEqual(games[0].boxArtURL, URL(string: "https://static-cdn.jtvnw.net/ttv-boxart/509658-110x147.jpg"))
        XCTAssertEqual(games[1].name, "Counter-Strike")
        XCTAssertEqual(games[2].name, "Minecraft")
    }

    /// Streamer hors ligne → fetchLiveStream renvoie nil (pas de section "Now Live").
    @MainActor
    func testFetchLiveStream_offlineReturnsNil() async throws {
        MockURLProtocol.reset()
        MockURLProtocol.registerJSON(
            url: URL(string: "https://gql.twitch.tv/gql")!,
            jsonString: #"{"data":{"user":{"stream":null}}}"#
        )
        TwitchAPIService.shared.invalidateGQLCache()

        let savedSession = TwitchAPIService.shared.urlSession
        defer { TwitchAPIService.shared.urlSession = savedSession }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        TwitchAPIService.shared.urlSession = URLSession(configuration: config)

        let stream = try await TwitchAPIService.shared.fetchLiveStream(login: "offline_streamer")
        XCTAssertNil(stream)
    }

    // MARK: - VOD Chat (uses JSONSerialization — no Codable type exists for chat)

    func testDecodeVODChat_fromFixture() throws {
        let json = loadFixture("gql_vod_chat")

        let jsonObj = try JSONSerialization.jsonObject(with: json) as! [String: Any]
        let dataDict = jsonObj["data"] as! [String: Any]
        let videoDict = dataDict["video"] as! [String: Any]
        let commentsDict = videoDict["comments"] as! [String: Any]
        let edges = commentsDict["edges"] as! [[String: Any]]

        XCTAssertEqual(edges.count, 2)

        let firstNode = edges[0]["node"] as! [String: Any]
        XCTAssertEqual(firstNode["id"] as? String, "comment-001")
        XCTAssertEqual(firstNode["contentOffsetSeconds"] as? Int, 120)

        let commenter = firstNode["commenter"] as! [String: Any]
        XCTAssertEqual(commenter["login"] as? String, "viewer1")
        XCTAssertEqual(commenter["displayName"] as? String, "ViewerOne")

        let message = firstNode["message"] as! [String: Any]
        let fragments = message["fragments"] as! [[String: Any]]
        XCTAssertEqual(fragments.count, 1)
        XCTAssertEqual(fragments[0]["text"] as? String, "LOL that was amazing")
    }

    // MARK: - Date Parsing

    func testParseDate_withFractionalSeconds() {
        let result = TwitchAPIService.shared.parseDate("2024-06-15T14:30:00.000Z")
        XCTAssertNotNil(result)
        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(identifier: "UTC")!
        let components = utcCalendar.dateComponents([.year, .month, .day, .hour, .minute], from: result)
        XCTAssertEqual(components.year, 2024)
        XCTAssertEqual(components.month, 6)
        XCTAssertEqual(components.day, 15)
        XCTAssertEqual(components.hour, 14)
        XCTAssertEqual(components.minute, 30)
    }

    func testParseDate_withoutFractionalSeconds() {
        let result = TwitchAPIService.shared.parseDate("2024-01-15T10:30:00Z")
        XCTAssertNotNil(result)
        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(identifier: "UTC")!
        let components = utcCalendar.dateComponents([.year, .month, .day, .hour, .minute], from: result)
        XCTAssertEqual(components.year, 2024)
        XCTAssertEqual(components.month, 1)
        XCTAssertEqual(components.day, 15)
        XCTAssertEqual(components.hour, 10)
        XCTAssertEqual(components.minute, 30)
    }

    func testParseDate_nilReturnsNow() {
        let before = Date()
        let result = TwitchAPIService.shared.parseDate(nil)
        let after = Date()
        XCTAssertGreaterThanOrEqual(result, before)
        XCTAssertLessThanOrEqual(result, after)
    }

    func testParseDate_invalidString_returnsNow() {
        let before = Date()
        let result = TwitchAPIService.shared.parseDate("not-a-date")
        let after = Date()
        XCTAssertGreaterThanOrEqual(result, before)
        XCTAssertLessThanOrEqual(result, after)
    }

    // MARK: - Helpers

    private func loadFixture(_ name: String) -> Data {
        let bundle = Bundle(for: type(of: self))
        guard let url = bundle.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"),
              let data = try? Data(contentsOf: url) else {
            let fixturePath = URL(fileURLWithPath: #file)
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Fixtures")
                .appendingPathComponent("\(name).json")
            return (try? Data(contentsOf: fixturePath)) ?? Data()
        }
        return data
    }
}
