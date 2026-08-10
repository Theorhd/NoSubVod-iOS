import XCTest
import SwiftData
@testable import NoSubVod

final class DownloadModelActorTests: XCTestCase {

    var container: ModelContainer!
    var actor: DownloadModelActor!

    override func setUp() async throws {
        container = ModelContainerHelper.createTestContainer()
        actor = DownloadModelActor(modelContainer: container)
    }

    // MARK: - createDownload

    func testCreateDownload_insertsIntoDatabase() async throws {
        await actor.createDownload(
            vodId: "vod-1",
            title: "Test VOD",
            thumbnailURL: URL(string: "https://example.com/thumb.jpg"),
            isSegment: false,
            startTime: nil,
            endTime: nil,
            quality: "1080p",
            streamerName: "TestStreamer",
            streamerProfileURL: URL(string: "https://example.com/pic.jpg"),
            gameName: "Just Chatting",
            viewCount: 50000
        )

        let context = ModelContext(container)
        let descriptor = FetchDescriptor<VODDownload>()
        let results = try context.fetch(descriptor)

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].vodId, "vod-1")
        XCTAssertEqual(results[0].title, "Test VOD")
        XCTAssertEqual(results[0].state, .downloading)
        XCTAssertEqual(results[0].progress, 0.0)
        XCTAssertEqual(results[0].quality, "1080p")
        XCTAssertEqual(results[0].streamerName, "TestStreamer")
        XCTAssertEqual(results[0].gameName, "Just Chatting")
        XCTAssertEqual(results[0].viewCount, 50000)
    }

    // MARK: - setDownloadStateFailed

    func testSetDownloadStateFailed_setsStateToFailed() async throws {
        await actor.createDownload(
            vodId: "vod-fail",
            title: "Will Fail",
            thumbnailURL: nil,
            isSegment: false,
            startTime: nil,
            endTime: nil,
            quality: nil
        )

        await actor.setDownloadStateFailed(vodId: "vod-fail")

        let context = ModelContext(container)
        let descriptor = FetchDescriptor<VODDownload>(
            predicate: #Predicate { $0.vodId == "vod-fail" }
        )
        let result = try context.fetch(descriptor).first!

        XCTAssertEqual(result.state, .failed)
    }

    func testSetDownloadStateFailed_doesNotCrashForUnknownVod() async throws {
        // Should not crash or throw
        await actor.setDownloadStateFailed(vodId: "non-existent-vod")

        let context = ModelContext(container)
        let descriptor = FetchDescriptor<VODDownload>()
        let results = try context.fetch(descriptor)
        XCTAssertEqual(results.count, 0)
    }

    // MARK: - updateSwiftDataProgress

    func testUpdateSwiftDataProgress_updatesProgressAndState() async throws {
        await actor.createDownload(
            vodId: "vod-progress",
            title: "Progress Test",
            thumbnailURL: nil,
            isSegment: false,
            startTime: nil,
            endTime: nil,
            quality: nil
        )

        await actor.updateSwiftDataProgress(vodId: "vod-progress", progress: 0.5, state: .downloading)

        let context = ModelContext(container)
        let descriptor = FetchDescriptor<VODDownload>(
            predicate: #Predicate { $0.vodId == "vod-progress" }
        )
        let result = try context.fetch(descriptor).first!

        XCTAssertEqual(result.progress, 0.5)
        XCTAssertEqual(result.state, .downloading)
    }

    func testUpdateSwiftDataProgress_pausedState() async throws {
        await actor.createDownload(
            vodId: "vod-pause",
            title: "Pause Test",
            thumbnailURL: nil,
            isSegment: false,
            startTime: nil,
            endTime: nil,
            quality: nil
        )

        await actor.updateSwiftDataProgress(vodId: "vod-pause", progress: 0.3, state: .paused)

        let context = ModelContext(container)
        let descriptor = FetchDescriptor<VODDownload>(
            predicate: #Predicate { $0.vodId == "vod-pause" }
        )
        let result = try context.fetch(descriptor).first!

        XCTAssertEqual(result.progress, 0.3)
        XCTAssertEqual(result.state, .paused)
    }

    // MARK: - completeDownload

    func testCompleteDownload_setsAllCompletionFields() async throws {
        await actor.createDownload(
            vodId: "vod-done",
            title: "Done Test",
            thumbnailURL: nil,
            isSegment: false,
            startTime: nil,
            endTime: nil,
            quality: nil
        )

        await actor.completeDownload(
            vodId: "vod-done",
            playlistPath: "downloads/vod-done/index.m3u8",
            durationSeconds: 3600.0
        )

        let context = ModelContext(container)
        let descriptor = FetchDescriptor<VODDownload>(
            predicate: #Predicate { $0.vodId == "vod-done" }
        )
        let result = try context.fetch(descriptor).first!

        XCTAssertEqual(result.localPlaylistPath, "downloads/vod-done/index.m3u8")
        XCTAssertEqual(result.progress, 1.0)
        XCTAssertEqual(result.state, .completed)
        XCTAssertEqual(result.durationSeconds, 3600.0)
    }

    // MARK: - fetchInterruptedDownloads

    func testFetchInterruptedDownloads_returnsOnlyDownloading() async throws {
        await actor.createDownload(vodId: "vod-dl", title: "DL", thumbnailURL: nil, isSegment: false, startTime: nil, endTime: nil, quality: nil)
        await actor.createDownload(vodId: "vod-paused-2", title: "P2", thumbnailURL: nil, isSegment: false, startTime: nil, endTime: nil, quality: nil)

        // Mark the second as paused
        await actor.updateSwiftDataProgress(vodId: "vod-paused-2", progress: 0.5, state: .paused)

        let interrupted = await actor.fetchInterruptedDownloads()
        // Only the downloading one should be returned
        XCTAssertEqual(interrupted.count, 1)
        XCTAssertEqual(interrupted[0].vodId, "vod-dl")
    }

    // MARK: - deleteDownload

    func testDeleteDownload_removesFromDatabase() async throws {
        await actor.createDownload(vodId: "vod-del", title: "Delete Me", thumbnailURL: nil, isSegment: false, startTime: nil, endTime: nil, quality: nil)

        await actor.deleteDownload(vodId: "vod-del")

        let context = ModelContext(container)
        let descriptor = FetchDescriptor<VODDownload>()
        let results = try context.fetch(descriptor)
        XCTAssertEqual(results.count, 0)
    }

    func testDeleteDownload_doesNotCrashForUnknownVod() async {
        await actor.deleteDownload(vodId: "never-existed")
        // Should not crash
    }
}
