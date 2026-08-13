import Foundation
import AVFoundation
import MediaPlayer
import UIKit

/// Everything the Control Center media widget needs to know about the
/// current playback session.
struct NowPlayingMetadata {
    let title: String
    let artist: String
    let album: String?
    let artworkURL: URL?
    let isLive: Bool
}

/// Builds the `nowPlayingInfo` dictionary for the Control Center media widget.
/// Pure and testable: given the metadata and player state, returns the exact
/// `[String: Any]` handed to `MPNowPlayingInfoCenter`.
enum NowPlayingInfoBuilder {
    static func makeInfo(metadata: NowPlayingMetadata, duration: Double?, elapsed: Double?, rate: Float, artwork: UIImage?) -> [String: Any] {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: metadata.title,
            MPMediaItemPropertyArtist: metadata.artist,
            MPNowPlayingInfoPropertyPlaybackRate: rate,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: Float(1.0)
        ]
        if let album = metadata.album {
            info[MPMediaItemPropertyAlbumTitle] = album
        }
        if metadata.isLive {
            info[MPNowPlayingInfoPropertyIsLiveStream] = true
        } else {
            if let duration, duration.isFinite, duration > 0 {
                info[MPMediaItemPropertyPlaybackDuration] = duration
            }
            if let elapsed {
                info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
            }
        }
        if let artwork {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: artwork.size) { _ in artwork }
        }
        return info
    }
}

/// Feeds the Control Center media widget and the lock screen:
/// - metadata (title, streamer, game, thumbnail artwork, duration),
/// - live progress (elapsed / rate, refreshed by a 1 s periodic observer),
/// - remote commands (play / pause / toggle / seek / skip) — this is what
///   makes the Control Center and lock-screen controls drive the player,
///   and what keeps the PiP progress in sync,
/// - `AVAudioSession` interruption handling so an incoming call pauses and
///   resumes playback without leaving the widget out of sync.
///
/// Singleton: remote commands must be registered exactly once and routed to
/// the current playback session. Each `PlayerViewModel` calls `configure` on
/// appear and `teardown(owner:)` on deinit; the ownership token prevents a
/// stale teardown from clearing a newer session's widget.
@MainActor
final class NowPlayingManager {
    static let shared = NowPlayingManager()

    private var player: AVPlayer?
    private var ownerToken: UUID?
    private var timeObserver: Any?
    private var artworkTask: Task<Void, Never>?
    private var interruptionObserver: NSObjectProtocol?
    private var shouldResumeAfterInterruption = false
    private var commandsEnabled = false

    private var metadata: NowPlayingMetadata?
    private var artwork: UIImage?
    /// URL of the currently held artwork — a re-configure for the same video
    /// keeps the cached image instead of re-fetching (no Control Center flicker).
    private var lastArtworkURL: URL?

    private init() {
        registerRemoteCommands()
    }

    /// Starts a playback session for the media widget. The previous session
    /// (if any) is replaced. Returns the ownership token to pass to
    /// `teardown(owner:)`.
    @discardableResult
    func configure(player: AVPlayer, metadata: NowPlayingMetadata) -> UUID {
        // A re-configure (view re-appear, session refresh) must not stack
        // periodic observers on the player.
        stopTimeObserver()

        let token = UUID()
        ownerToken = token
        self.player = player
        self.metadata = metadata

        if metadata.artworkURL != lastArtworkURL {
            artwork = nil
            lastArtworkURL = metadata.artworkURL
        }

        setCommandsEnabled(true)
        observeInterruptions()
        startTimeObserver(on: player)
        if let artworkURL = metadata.artworkURL, artwork == nil {
            fetchArtwork(from: artworkURL)
        }
        refreshNowPlayingInfo()
        return token
    }

    /// Ends the playback session — but only if `owner` is still the current
    /// one (a stale deinit must not clear a newer session's widget).
    func teardown(owner: UUID) {
        guard owner == ownerToken else { return }
        ownerToken = nil

        stopTimeObserver()
        artworkTask?.cancel()
        artworkTask = nil
        artwork = nil
        lastArtworkURL = nil
        metadata = nil
        player = nil
        shouldResumeAfterInterruption = false
        setCommandsEnabled(false)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    /// Recomputes the widget content from the player's current state.
    /// Called by the periodic observer, remote command handlers, and the
    /// interruption handler.
    func refreshNowPlayingInfo() {
        guard let player, let metadata else { return }
        // `rate` is the ground truth: 1.0 while playing (even mid-buffer),
        // 0.0 when paused. `timeControlStatus` is unreliable on players
        // without an item, so it is not used here.
        let rate = player.rate
        let duration: Double? = player.currentItem?.duration.seconds
        let elapsed: Double? = metadata.isLive ? nil : player.currentTime().seconds
        MPNowPlayingInfoCenter.default().nowPlayingInfo = NowPlayingInfoBuilder.makeInfo(
            metadata: metadata,
            duration: duration,
            elapsed: elapsed,
            rate: rate,
            artwork: artwork
        )
    }

    // MARK: - Remote commands

    func handlePlay() {
        player?.play()
        refreshNowPlayingInfo()
    }

    func handlePause() {
        player?.pause()
        refreshNowPlayingInfo()
    }

    func handleTogglePlayPause() {
        if (player?.rate ?? 0) > 0 {
            handlePause()
        } else {
            handlePlay()
        }
    }

    func handleSeek(to time: Double) {
        guard let player else { return }
        let target = CMTime(seconds: time, preferredTimescale: 600)
        player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { _ in
            Task { @MainActor [weak self] in
                self?.refreshNowPlayingInfo()
            }
        }
    }

    func handleSkip(by seconds: Double) {
        guard let player else { return }
        let target = player.currentTime() + CMTime(seconds: seconds, preferredTimescale: 600)
        handleSeek(to: target.seconds)
    }

    /// Registered exactly once, at init. Per-session `setCommandsEnabled`
    /// toggles availability — targets are never stacked across sessions.
    private func registerRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.handlePlay()
            return .success
        }

        center.pauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.handlePause()
            return .success
        }

        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.handleTogglePlayPause()
            return .success
        }

        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let self, let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self.handleSeek(to: event.positionTime)
            return .success
        }

        center.skipForwardCommand.preferredIntervals = [10]
        center.skipForwardCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.handleSkip(by: 10)
            return .success
        }

        center.skipBackwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.handleSkip(by: -10)
            return .success
        }
    }

    private func setCommandsEnabled(_ enabled: Bool) {
        guard commandsEnabled != enabled else { return }
        commandsEnabled = enabled
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = enabled
        center.pauseCommand.isEnabled = enabled
        center.togglePlayPauseCommand.isEnabled = enabled
        // Scrubbing / skipping only makes sense for VODs.
        center.changePlaybackPositionCommand.isEnabled = enabled && !(metadata?.isLive ?? false)
        center.skipForwardCommand.isEnabled = enabled && !(metadata?.isLive ?? false)
        center.skipBackwardCommand.isEnabled = enabled && !(metadata?.isLive ?? false)
    }

    // MARK: - Interruptions (phone call, Siri, …)

    private func observeInterruptions() {
        guard interruptionObserver == nil else { return }
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.handleInterruption(notification)
        }
    }

    /// Internal seam, unit-tested directly.
    func handleInterruption(_ notification: Notification) {
        guard let typeRaw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }

        switch type {
        case .began:
            shouldResumeAfterInterruption = (player?.rate ?? 0) > 0
            handlePause()
        case .ended:
            let optionsRaw = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: optionsRaw)
            if shouldResumeAfterInterruption, options.contains(.shouldResume) {
                // Re-activate the session before resuming (the interruption
                // may have deactivated it) so playback restarts seamlessly.
                try? AVAudioSession.sharedInstance().setActive(true)
                // Live: rejoin the edge — resuming where the interruption
                // began would replay stale content and drift ever further
                // behind the broadcast.
                if metadata?.isLive == true {
                    seekToLiveEdge()
                }
                handlePlay()
            }
            shouldResumeAfterInterruption = false
        @unknown default:
            break
        }
    }

    /// Jumps to the live edge, minus a small cushion so AVPlayer never seeks
    /// past the newest complete segment (which would stall the resume).
    private func seekToLiveEdge() {
        guard let player,
              let range = player.currentItem?.seekableTimeRanges.last?.timeRangeValue else { return }
        let cushion = CMTime(seconds: 2, preferredTimescale: 600)
        let target = range.end - cushion
        player.seek(to: target > .zero ? target : range.end,
                    toleranceBefore: .zero, toleranceAfter: .zero)
    }

    // MARK: - Info refresh & artwork

    private func startTimeObserver(on player: AVPlayer) {
        stopTimeObserver()
        let interval = CMTime(seconds: 1, preferredTimescale: 1)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.refreshNowPlayingInfo()
            }
        }
    }

    private func stopTimeObserver() {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
    }

    private func fetchArtwork(from url: URL) {
        artworkTask?.cancel()
        artworkTask = Task { [weak self] in
            guard let self else { return }
            let image = await self.downloadImage(from: url)
            guard !Task.isCancelled else { return }
            self.artwork = image
            self.refreshNowPlayingInfo()
        }
    }

    private func downloadImage(from url: URL) async -> UIImage? {
        // Reuse the app's existing image cache (same one CachedAsyncImage uses).
        let key = url.absoluteString
        if let cached = ImageCache.shared.get(forKey: key) { return cached }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            guard let image = UIImage(data: data) else { return nil }
            ImageCache.shared.set(image, forKey: key)
            return image
        } catch {
            return nil
        }
    }
}
