import XCTest
import SwiftData
@testable import NoSubVod

final class HistoryManagerActorTests: XCTestCase {

    var container: ModelContainer!
    var actor: HistoryManagerActor!

    override func setUp() async throws {
        container = ModelContainerHelper.createTestContainer()
        actor = HistoryManagerActor(modelContainer: container)
    }

    func testUpdateHistory_newEntry_createsEntry() async throws {
        await actor.updateHistory(
            vodId: "vod-new",
            timecode: 300,
            duration: 3600,
            title: "New VOD",
            streamerName: "Streamer",
            streamerProfileURL: URL(string: "https://example.com/pic.jpg"),
            gameName: "Game",
            viewCount: 1000,
            previewThumbnailURL: URL(string: "https://example.com/thumb.jpg")
        )

        let context = ModelContext(container)
        let descriptor = FetchDescriptor<PersistentHistoryEntry>()
        let results = try context.fetch(descriptor)

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].vodId, "vod-new")
        XCTAssertEqual(results[0].timecode, 300)
        XCTAssertEqual(results[0].duration, 3600)
        XCTAssertEqual(results[0].title, "New VOD")
        XCTAssertEqual(results[0].streamerName, "Streamer")
        XCTAssertEqual(results[0].gameName, "Game")
        XCTAssertEqual(results[0].viewCount, 1000)
    }

    func testUpdateHistory_existingEntry_updatesValues() async throws {
        // First, create an entry
        await actor.updateHistory(
            vodId: "vod-existing",
            timecode: 100,
            duration: 2000,
            title: "Old Title",
            streamerName: "Old Name",
            streamerProfileURL: nil,
            gameName: "Old Game",
            viewCount: 500,
            previewThumbnailURL: nil
        )

        // Update the same vodId
        await actor.updateHistory(
            vodId: "vod-existing",
            timecode: 500,
            duration: 3000,
            title: "New Title",
            streamerName: "New Name",
            streamerProfileURL: URL(string: "https://example.com/new.jpg"),
            gameName: "New Game",
            viewCount: 1500,
            previewThumbnailURL: URL(string: "https://example.com/newthumb.jpg")
        )

        let context = ModelContext(container)
        let descriptor = FetchDescriptor<PersistentHistoryEntry>(
            predicate: #Predicate { $0.vodId == "vod-existing" }
        )
        let result = try context.fetch(descriptor).first!

        XCTAssertEqual(result.timecode, 500)
        XCTAssertEqual(result.duration, 3000)
        XCTAssertEqual(result.title, "New Title")
        XCTAssertEqual(result.streamerName, "New Name")
        XCTAssertEqual(result.gameName, "New Game")
        XCTAssertEqual(result.viewCount, 1500)
    }

    func testUpdateHistory_partialMetadataUpdate() async throws {
        await actor.updateHistory(
            vodId: "vod-partial",
            timecode: 200,
            duration: 1000,
            title: "Title",
            streamerName: nil,
            streamerProfileURL: nil,
            gameName: nil,
            viewCount: nil,
            previewThumbnailURL: nil
        )

        // Update only some metadata
        await actor.updateHistory(
            vodId: "vod-partial",
            timecode: 400,
            duration: 1000,
            title: nil,       // nil → should NOT overwrite existing
            streamerName: "New Streamer",
            streamerProfileURL: nil,
            gameName: "New Game",
            viewCount: nil,
            previewThumbnailURL: nil
        )

        let context = ModelContext(container)
        let descriptor = FetchDescriptor<PersistentHistoryEntry>(
            predicate: #Predicate { $0.vodId == "vod-partial" }
        )
        let result = try context.fetch(descriptor).first!

        XCTAssertEqual(result.timecode, 400)
        // title should still be "Title" because nil was passed (no overwrite)
        XCTAssertEqual(result.title, "Title")
        XCTAssertEqual(result.streamerName, "New Streamer")
        XCTAssertEqual(result.gameName, "New Game")
    }
}
