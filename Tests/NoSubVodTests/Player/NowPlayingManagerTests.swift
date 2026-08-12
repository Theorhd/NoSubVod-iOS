import XCTest
import AVFoundation
import MediaPlayer
@testable import NoSubVod

@MainActor
final class NowPlayingManagerTests: XCTestCase {
    private let manager = NowPlayingManager.shared

    private func metadata(isLive: Bool = false, artworkURL: URL? = nil) -> NowPlayingMetadata {
        NowPlayingMetadata(title: "Test Title", artist: "Test Artist", album: "Test Game", artworkURL: artworkURL, isLive: isLive)
    }

    /// Isolates the process-global widget state between tests.
    private func tearDown(token: UUID?) {
        if let token {
            manager.teardown(owner: token)
        }
        manager.teardown(owner: UUID()) // safety net: no-op unless leftover
        XCTAssertNil(MPNowPlayingInfoCenter.default().nowPlayingInfo)
    }

    func testConfigure_setsTitleArtistAlbumAndRate() {
        let player = AVPlayer()
        let token = manager.configure(player: player, metadata: metadata())
        defer { tearDown(token: token) }

        let info = MPNowPlayingInfoCenter.default().nowPlayingInfo
        XCTAssertEqual(info?[MPMediaItemPropertyTitle] as? String, "Test Title")
        XCTAssertEqual(info?[MPMediaItemPropertyArtist] as? String, "Test Artist")
        XCTAssertEqual(info?[MPMediaItemPropertyAlbumTitle] as? String, "Test Game")
        XCTAssertEqual(info?[MPNowPlayingInfoPropertyPlaybackRate] as? Float, 0.0)
    }

    func testConfigure_live_setsLiveFlag_andDisablesSeekCommands() {
        let player = AVPlayer()
        let token = manager.configure(player: player, metadata: metadata(isLive: true))
        defer { tearDown(token: token) }

        let info = MPNowPlayingInfoCenter.default().nowPlayingInfo
        XCTAssertEqual(info?[MPNowPlayingInfoPropertyIsLiveStream] as? Bool, true)
        XCTAssertNil(info?[MPMediaItemPropertyPlaybackDuration])

        let center = MPRemoteCommandCenter.shared()
        XCTAssertTrue(center.playCommand.isEnabled)
        XCTAssertTrue(center.pauseCommand.isEnabled)
        XCTAssertFalse(center.changePlaybackPositionCommand.isEnabled)
        XCTAssertFalse(center.skipForwardCommand.isEnabled)
        XCTAssertFalse(center.skipBackwardCommand.isEnabled)
    }

    func testHandlePlayAndPause_updatesPlayerAndInfo() {
        let player = AVPlayer()
        let token = manager.configure(player: player, metadata: metadata())
        defer { tearDown(token: token) }

        manager.handlePlay()
        XCTAssertEqual(player.rate, 1.0)
        XCTAssertEqual(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Float, 1.0)

        manager.handlePause()
        XCTAssertEqual(player.rate, 0.0)
        XCTAssertEqual(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Float, 0.0)
    }

    func testHandleTogglePlayPause() {
        let player = AVPlayer()
        let token = manager.configure(player: player, metadata: metadata())
        defer { tearDown(token: token) }

        manager.handleTogglePlayPause()
        XCTAssertEqual(player.rate, 1.0)

        manager.handleTogglePlayPause()
        XCTAssertEqual(player.rate, 0.0)
    }

    func testTeardown_clearsInfo_forMatchingOwner() {
        let player = AVPlayer()
        let token = manager.configure(player: player, metadata: metadata())
        XCTAssertNotNil(MPNowPlayingInfoCenter.default().nowPlayingInfo)

        manager.teardown(owner: token)
        XCTAssertNil(MPNowPlayingInfoCenter.default().nowPlayingInfo)
    }

    func testTeardown_ignored_forOtherOwner() {
        let player = AVPlayer()
        let first = manager.configure(player: player, metadata: metadata())
        // A newer session replaces the first one.
        let second = manager.configure(player: player, metadata: metadata())
        defer { tearDown(token: second) }

        // A stale teardown from the previous session must not clear the
        // current session's widget.
        manager.teardown(owner: first)
        XCTAssertEqual(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyTitle] as? String, "Test Title")
    }

    func testInterruption_begins_pauses_thenResumesWithOption() {
        let player = AVPlayer()
        let token = manager.configure(player: player, metadata: metadata())
        defer { tearDown(token: token) }
        manager.handlePlay()
        XCTAssertEqual(player.rate, 1.0)

        let began = Notification(name: AVAudioSession.interruptionNotification, userInfo: [
            AVAudioSessionInterruptionTypeKey: UInt(AVAudioSession.InterruptionType.began.rawValue)
        ])
        manager.handleInterruption(began)
        XCTAssertEqual(player.rate, 0.0)

        let ended = Notification(name: AVAudioSession.interruptionNotification, userInfo: [
            AVAudioSessionInterruptionTypeKey: UInt(AVAudioSession.InterruptionType.ended.rawValue),
            AVAudioSessionInterruptionOptionKey: UInt(AVAudioSession.InterruptionOptions.shouldResume.rawValue)
        ])
        manager.handleInterruption(ended)
        XCTAssertEqual(player.rate, 1.0)
    }

    func testInterruption_endedWithoutOption_doesNotResume() {
        let player = AVPlayer()
        let token = manager.configure(player: player, metadata: metadata())
        defer { tearDown(token: token) }
        manager.handlePlay()

        let began = Notification(name: AVAudioSession.interruptionNotification, userInfo: [
            AVAudioSessionInterruptionTypeKey: UInt(AVAudioSession.InterruptionType.began.rawValue)
        ])
        manager.handleInterruption(began)

        let ended = Notification(name: AVAudioSession.interruptionNotification, userInfo: [
            AVAudioSessionInterruptionTypeKey: UInt(AVAudioSession.InterruptionType.ended.rawValue)
        ])
        manager.handleInterruption(ended)
        XCTAssertEqual(player.rate, 0.0)
    }

    func testInterruption_beganWhenPaused_doesNotResumeLater() {
        let player = AVPlayer()
        let token = manager.configure(player: player, metadata: metadata())
        defer { tearDown(token: token) }

        let began = Notification(name: AVAudioSession.interruptionNotification, userInfo: [
            AVAudioSessionInterruptionTypeKey: UInt(AVAudioSession.InterruptionType.began.rawValue)
        ])
        manager.handleInterruption(began)

        let ended = Notification(name: AVAudioSession.interruptionNotification, userInfo: [
            AVAudioSessionInterruptionTypeKey: UInt(AVAudioSession.InterruptionType.ended.rawValue),
            AVAudioSessionInterruptionOptionKey: UInt(AVAudioSession.InterruptionOptions.shouldResume.rawValue)
        ])
        manager.handleInterruption(ended)
        XCTAssertEqual(player.rate, 0.0) // was paused before the interruption: stay paused
    }

    func testInterruption_live_resumesAtLiveEdge() {
        let player = AVPlayer()
        let token = manager.configure(player: player, metadata: metadata(isLive: true))
        defer { tearDown(token: token) }
        manager.handlePlay()

        let began = Notification(name: AVAudioSession.interruptionNotification, userInfo: [
            AVAudioSessionInterruptionTypeKey: UInt(AVAudioSession.InterruptionType.began.rawValue)
        ])
        manager.handleInterruption(began)
        XCTAssertEqual(player.rate, 0.0)

        // No item → no seekable range → the live-edge seek is a safe no-op;
        // playback still resumes.
        let ended = Notification(name: AVAudioSession.interruptionNotification, userInfo: [
            AVAudioSessionInterruptionTypeKey: UInt(AVAudioSession.InterruptionType.ended.rawValue),
            AVAudioSessionInterruptionOptionKey: UInt(AVAudioSession.InterruptionOptions.shouldResume.rawValue)
        ])
        manager.handleInterruption(ended)
        XCTAssertEqual(player.rate, 1.0)
    }

    func testConfigure_sameArtworkURL_keepsCachedArtwork() async {
        let url = URL(string: "https://example.com/artwork.jpg")!
        ImageCache.shared.set(UIImage(), forKey: url.absoluteString)
        let player = AVPlayer()

        _ = manager.configure(player: player, metadata: metadata(artworkURL: url))
        // The first fetch is async even on a cache hit — wait for it to land.
        let deadline = Date().addingTimeInterval(3)
        while Date() < deadline,
              MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork] == nil {
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertNotNil(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork])

        // Re-configuring the same video must keep the artwork — no refetch,
        // no flicker. Synchronously visible right after configure returns.
        let second = manager.configure(player: player, metadata: metadata(artworkURL: url))
        defer { tearDown(token: second) }
        XCTAssertNotNil(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork])
    }
}
