import XCTest
@testable import NoSubVod

final class VODCodableTests: XCTestCase {

    // MARK: - VOD Codable

    func testVOD_encodeDecode_fullRoundTrip() throws {
        let vod = VOD(
            id: "2170531517",
            title: "Test VOD Title",
            lengthSeconds: 12360,
            previewThumbnailURL: URL(string: "https://example.com/thumb.jpg"),
            createdAt: Date(timeIntervalSince1970: 1718000000),
            viewCount: 1542000,
            language: "en",
            broadcastType: "HIGHLIGHT",
            game: Game(id: "509658", name: "Just Chatting", boxArtURL: URL(string: "https://example.com/boxart.jpg")),
            owner: VODOwner(login: "teststreamer", displayName: "Test Streamer", profileImageURL: URL(string: "https://example.com/avatar.jpg"))
        )

        let data = try JSONEncoder().encode(vod)
        let decoded = try JSONDecoder().decode(VOD.self, from: data)

        XCTAssertEqual(decoded.id, vod.id)
        XCTAssertEqual(decoded.title, vod.title)
        XCTAssertEqual(decoded.lengthSeconds, vod.lengthSeconds)
        XCTAssertEqual(decoded.previewThumbnailURL, vod.previewThumbnailURL)
        XCTAssertEqual(decoded.createdAt.timeIntervalSince1970, vod.createdAt.timeIntervalSince1970, accuracy: 1.0)
        XCTAssertEqual(decoded.viewCount, vod.viewCount)
        XCTAssertEqual(decoded.language, vod.language)
        XCTAssertEqual(decoded.broadcastType, vod.broadcastType)
        XCTAssertEqual(decoded.game?.name, "Just Chatting")
        XCTAssertEqual(decoded.owner?.login, "teststreamer")
    }

    func testVOD_decode_withoutOptionals() throws {
        // VOD uses synthesized Codable. The API always provides ISO8601 dates.
        // Round-trip encoding/decoding is the most reliable way to test structural conformance.
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let vod = VOD(
            id: "minimal-123",
            title: "Minimal VOD",
            lengthSeconds: 600,
            previewThumbnailURL: nil,
            createdAt: Date(timeIntervalSince1970: 1718000000),
            viewCount: 1000,
            language: nil,
            broadcastType: nil,
            game: nil,
            owner: nil
        )

        let data = try encoder.encode(vod)
        let decoded = try decoder.decode(VOD.self, from: data)

        XCTAssertEqual(decoded.id, "minimal-123")
        XCTAssertEqual(decoded.title, "Minimal VOD")
        XCTAssertEqual(decoded.lengthSeconds, 600)
        XCTAssertEqual(decoded.viewCount, 1000)
        XCTAssertNil(decoded.language)
        XCTAssertNil(decoded.owner)
    }

    func testVOD_fullJSON_roundTrip() throws {
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let vod = VOD(
            id: "v123",
            title: "Test",
            lengthSeconds: 1000,
            previewThumbnailURL: nil,
            createdAt: Date(),
            viewCount: 500,
            language: nil,
            broadcastType: nil,
            game: nil,
            owner: nil
        )

        let data = try encoder.encode(vod)
        let decoded = try decoder.decode(VOD.self, from: data)

        XCTAssertEqual(decoded.id, "v123")
        XCTAssertEqual(decoded.title, "Test")
        XCTAssertNil(decoded.previewThumbnailURL)
    }

    // MARK: - Game Codable

    func testGame_encodeDecode_roundTrip() throws {
        let game = Game(
            id: "509658",
            name: "Just Chatting",
            boxArtURL: URL(string: "https://example.com/boxart.jpg")
        )

        let data = try JSONEncoder().encode(game)
        let decoded = try JSONDecoder().decode(Game.self, from: data)

        XCTAssertEqual(decoded.id, "509658")
        XCTAssertEqual(decoded.name, "Just Chatting")
        XCTAssertEqual(decoded.boxArtURL, game.boxArtURL)
    }

    // MARK: - VODOwner Codable

    func testVODOwner_encodeDecode_roundTrip() throws {
        let owner = VODOwner(
            login: "testuser",
            displayName: "Test User",
            profileImageURL: URL(string: "https://example.com/avatar.jpg")
        )

        let data = try JSONEncoder().encode(owner)
        let decoded = try JSONDecoder().decode(VODOwner.self, from: data)

        XCTAssertEqual(decoded.login, "testuser")
        XCTAssertEqual(decoded.displayName, "Test User")
        XCTAssertEqual(decoded.profileImageURL, owner.profileImageURL)
    }

    // MARK: - TwitchUser Codable

    func testTwitchUser_encodeDecode_roundTrip() throws {
        let user = TwitchUser(
            id: "user-123",
            login: "testuser",
            displayName: "Test User",
            profileImageURL: URL(string: "https://example.com/avatar.jpg"),
            createdAt: Date(timeIntervalSince1970: 1700000000)
        )

        let data = try JSONEncoder().encode(user)
        let decoded = try JSONDecoder().decode(TwitchUser.self, from: data)

        XCTAssertEqual(decoded.id, "user-123")
        XCTAssertEqual(decoded.login, "testuser")
        XCTAssertEqual(decoded.displayName, "Test User")
    }
}
