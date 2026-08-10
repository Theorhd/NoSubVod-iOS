import XCTest
@testable import NoSubVod

final class VODDownloadStateTests: XCTestCase {

    // MARK: - DownloadState enum

    func testDownloadState_rawValues() {
        XCTAssertEqual(DownloadState.downloading.rawValue, "downloading")
        XCTAssertEqual(DownloadState.paused.rawValue, "paused")
        XCTAssertEqual(DownloadState.completed.rawValue, "completed")
        XCTAssertEqual(DownloadState.failed.rawValue, "failed")
    }

    func testDownloadState_initFromValidRawValues() {
        XCTAssertEqual(DownloadState(rawValue: "downloading"), .downloading)
        XCTAssertEqual(DownloadState(rawValue: "paused"), .paused)
        XCTAssertEqual(DownloadState(rawValue: "completed"), .completed)
        XCTAssertEqual(DownloadState(rawValue: "failed"), .failed)
    }

    func testDownloadState_initFromInvalidRawValue_returnsNil() {
        XCTAssertNil(DownloadState(rawValue: "unknown"))
        XCTAssertNil(DownloadState(rawValue: ""))
    }

    // MARK: - VODDownload state property

    func testVODDownload_stateTransient_defaultsToDownloading() {
        let download = VODDownload(
            vodId: "123",
            title: "Test VOD",
            thumbnailURL: nil
        )
        XCTAssertEqual(download.state, .downloading)
        XCTAssertEqual(download.stateRaw, "downloading")
    }

    func testVODDownload_stateSetter_updatesRawValue() {
        let download = VODDownload(
            vodId: "123",
            title: "Test VOD",
            thumbnailURL: nil
        )
        download.state = .completed
        XCTAssertEqual(download.state, .completed)
        XCTAssertEqual(download.stateRaw, "completed")
    }

    func testVODDownload_stateGetter_fallbacksToFailedForInvalidRaw() {
        let download = VODDownload(
            vodId: "123",
            title: "Test VOD",
            thumbnailURL: nil
        )
        // Manually set an invalid raw value
        download.stateRaw = "garbage"
        XCTAssertEqual(download.state, .failed)
    }

    // MARK: - VODDownload init defaults

    func testVODDownload_init_progressIsZero() {
        let download = VODDownload(
            vodId: "abc",
            title: "Test",
            thumbnailURL: URL(string: "https://example.com/thumb.jpg")
        )
        XCTAssertEqual(download.progress, 0.0)
    }

    func testVODDownload_init_optionalFieldsAreNil() {
        let download = VODDownload(
            vodId: "abc",
            title: "Test",
            thumbnailURL: nil
        )
        XCTAssertFalse(download.isSegment)
        XCTAssertNil(download.startTime)
        XCTAssertNil(download.endTime)
        XCTAssertNil(download.quality)
        XCTAssertNil(download.streamerName)
        XCTAssertNil(download.streamerProfileURL)
        XCTAssertNil(download.gameName)
        XCTAssertNil(download.viewCount)
        XCTAssertNil(download.localPlaylistPath)
        XCTAssertNil(download.durationSeconds)
    }

    func testVODDownload_init_fullMetadata_retainsAllValues() {
        let thumbnail = URL(string: "https://example.com/thumb.jpg")
        let profile = URL(string: "https://example.com/profile.jpg")

        let download = VODDownload(
            vodId: "full-vod-123",
            title: "Full VOD",
            thumbnailURL: thumbnail,
            isSegment: true,
            startTime: 300,
            endTime: 900,
            quality: "1080p",
            streamerName: "TestStreamer",
            streamerProfileURL: profile,
            gameName: "Just Chatting",
            viewCount: 50000
        )

        XCTAssertEqual(download.vodId, "full-vod-123")
        XCTAssertEqual(download.title, "Full VOD")
        XCTAssertEqual(download.thumbnailURL, thumbnail)
        XCTAssertTrue(download.isSegment)
        XCTAssertEqual(download.startTime, 300)
        XCTAssertEqual(download.endTime, 900)
        XCTAssertEqual(download.quality, "1080p")
        XCTAssertEqual(download.streamerName, "TestStreamer")
        XCTAssertEqual(download.streamerProfileURL, profile)
        XCTAssertEqual(download.gameName, "Just Chatting")
        XCTAssertEqual(download.viewCount, 50000)
    }
}
