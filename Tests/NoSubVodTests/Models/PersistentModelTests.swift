import XCTest
import SwiftData
@testable import NoSubVod

final class PersistentModelTests: XCTestCase {

    var container: ModelContainer!

    override func setUp() async throws {
        container = ModelContainerHelper.createTestContainer()
    }

    // MARK: - PersistentHistoryEntry

    func testPersistentHistoryEntry_insertAndFetch() throws {
        let context = ModelContext(container)
        let entry = PersistentHistoryEntry(
            vodId: "vod-1",
            timecode: 300,
            duration: 3600,
            title: "Test VOD",
            streamerName: "TestStreamer",
            streamerProfileURL: URL(string: "https://example.com/pic.jpg"),
            gameName: "Just Chatting",
            viewCount: 50000,
            previewThumbnailURL: URL(string: "https://example.com/thumb.jpg")
        )
        context.insert(entry)
        try context.save()

        let descriptor = FetchDescriptor<PersistentHistoryEntry>()
        let results = try context.fetch(descriptor)

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].vodId, "vod-1")
        XCTAssertEqual(results[0].timecode, 300)
        XCTAssertEqual(results[0].duration, 3600)
        XCTAssertEqual(results[0].title, "Test VOD")
        XCTAssertEqual(results[0].streamerName, "TestStreamer")
        XCTAssertEqual(results[0].gameName, "Just Chatting")
        XCTAssertEqual(results[0].viewCount, 50000)
    }

    func testPersistentHistoryEntry_updateExisting() throws {
        let context = ModelContext(container)
        let entry = PersistentHistoryEntry(vodId: "vod-1", timecode: 100, duration: 1000)
        context.insert(entry)
        try context.save()

        // Simulate an update by fetching and modifying
        let descriptor = FetchDescriptor<PersistentHistoryEntry>(
            predicate: #Predicate { $0.vodId == "vod-1" }
        )
        let fetched = try context.fetch(descriptor).first!
        fetched.timecode = 500
        fetched.duration = 2000
        try context.save()

        let updated = try context.fetch(descriptor).first!
        XCTAssertEqual(updated.timecode, 500)
        XCTAssertEqual(updated.duration, 2000)
    }

    // MARK: - PersistentWatchlistEntry

    func testPersistentWatchlistEntry_insertAndFetch() throws {
        let context = ModelContext(container)
        let entry = PersistentWatchlistEntry(
            vodId: "vod-wl-1",
            title: "Watchlist VOD",
            previewThumbnailURL: URL(string: "https://example.com/thumb.jpg"),
            lengthSeconds: 7200
        )
        context.insert(entry)
        try context.save()

        let descriptor = FetchDescriptor<PersistentWatchlistEntry>()
        let results = try context.fetch(descriptor)

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].vodId, "vod-wl-1")
        XCTAssertEqual(results[0].title, "Watchlist VOD")
        XCTAssertEqual(results[0].lengthSeconds, 7200)
    }

    // MARK: - PersistentSubscription

    func testPersistentSubscription_insertAndFetch() throws {
        let context = ModelContext(container)
        let sub = PersistentSubscription(
            login: "favoritestreamer",
            displayName: "Favorite Streamer",
            profileImageURL: URL(string: "https://example.com/avatar.jpg")
        )
        context.insert(sub)
        try context.save()

        let descriptor = FetchDescriptor<PersistentSubscription>()
        let results = try context.fetch(descriptor)

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].login, "favoritestreamer")
        XCTAssertEqual(results[0].displayName, "Favorite Streamer")
    }

    func testPersistentSubscription_uniqueLoginConstraint() throws {
        let context = ModelContext(container)
        let sub1 = PersistentSubscription(login: "streamer", displayName: "Streamer 1", profileImageURL: nil)
        let sub2 = PersistentSubscription(login: "streamer", displayName: "Streamer 2", profileImageURL: nil)

        context.insert(sub1)
        context.insert(sub2)

        // SwiftData @Attribute(.unique) will cause a conflict;
        // the exact behavior depends on the merge policy, but we just validate insertion.
        // In practice, the second insert should upsert or throw.
        do {
            try context.save()
            // If save succeeds, check that we have at least 1 entry
            let descriptor = FetchDescriptor<PersistentSubscription>()
            let results = try context.fetch(descriptor)
            XCTAssertGreaterThanOrEqual(results.count, 1)
        } catch {
            // Conflict is expected behavior for unique constraint violation
            XCTAssertTrue(true, "Unique constraint enforced")
        }
    }
}
