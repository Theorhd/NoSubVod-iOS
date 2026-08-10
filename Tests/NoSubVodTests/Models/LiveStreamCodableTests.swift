import XCTest
@testable import NoSubVod

final class LiveStreamCodableTests: XCTestCase {

    func testLiveStream_encodeDecode_roundTrip() throws {
        let stream = LiveStream(
            id: "42080878076",
            title: "Live Test Stream",
            previewImageURL: URL(string: "https://example.com/preview.jpg"),
            viewerCount: 15000,
            language: "en",
            startedAt: Date(timeIntervalSince1970: 1718000000),
            broadcaster: LiveStreamBroadcaster(
                id: "broadcaster-1",
                login: "teststreamer",
                displayName: "Test Streamer",
                profileImageURL: URL(string: "https://example.com/avatar.jpg")
            ),
            game: Game(id: "509658", name: "Just Chatting", boxArtURL: nil)
        )

        let data = try JSONEncoder().encode(stream)
        let decoded = try JSONDecoder().decode(LiveStream.self, from: data)

        XCTAssertEqual(decoded.id, stream.id)
        XCTAssertEqual(decoded.title, stream.title)
        XCTAssertEqual(decoded.viewerCount, 15000)
        XCTAssertEqual(decoded.language, "en")
        XCTAssertEqual(decoded.broadcaster.login, "teststreamer")
        XCTAssertEqual(decoded.game?.name, "Just Chatting")
    }

    func testLiveStreamBroadcaster_encodeDecode_roundTrip() throws {
        let broadcaster = LiveStreamBroadcaster(
            id: "b1",
            login: "streamer",
            displayName: "Streamer Name",
            profileImageURL: URL(string: "https://example.com/pic.jpg")
        )

        let data = try JSONEncoder().encode(broadcaster)
        let decoded = try JSONDecoder().decode(LiveStreamBroadcaster.self, from: data)

        XCTAssertEqual(decoded.id, "b1")
        XCTAssertEqual(decoded.login, "streamer")
        XCTAssertEqual(decoded.displayName, "Streamer Name")
    }

    func testLiveStreamsPage_encodeDecode_roundTrip() throws {
        let page = LiveStreamsPage(
            items: [
                LiveStream(
                    id: "s1", title: "Stream 1", previewImageURL: nil, viewerCount: 100,
                    language: "en", startedAt: Date(),
                    broadcaster: LiveStreamBroadcaster(id: "b1", login: "s1", displayName: "S1", profileImageURL: nil),
                    game: nil
                )
            ],
            nextCursor: "cursor-abc",
            hasMore: true
        )

        let data = try JSONEncoder().encode(page)
        let decoded = try JSONDecoder().decode(LiveStreamsPage.self, from: data)

        XCTAssertEqual(decoded.items.count, 1)
        XCTAssertEqual(decoded.nextCursor, "cursor-abc")
        XCTAssertTrue(decoded.hasMore)
    }
}
