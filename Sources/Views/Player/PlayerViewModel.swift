import Foundation
import AVFoundation
import AVKit
import Combine
import SwiftUI
import TSPlayerKit

// MARK: - Native fullscreen delegate

/// Tracks AVKitʼs own full-screen presentation (the button in the
/// AVPlayerViewController toolbar) — the second full-screen path, alongside
/// our modal presentation (`PlayerHostViewController.presentFullScreen`).
///
/// Two jobs:
/// - publishes the unified `isFullScreen` state (begin immediately, end only
///   once the exit transition has fully completed),
/// - compensates the render-pipeline layer detach: AVKit's transition resets
///   the player rate, so playback is re-issued (play) when the transition
///   completes if it was playing before it started. This fixes the
///   "full-screen button pauses the player" and "black zone after exit"
///   regressions.
final class PlayerFullscreenDelegate: NSObject, AVPlayerViewControllerDelegate, @unchecked Sendable {
    /// True when playback was in progress before a full-screen transition —
    /// the transition must then be compensated by a play() on completion.
    private(set) var shouldResumeAfterTransition = false

    /// True while PiP is active. Rotation-driven full-screen entry is refused
    /// in this state: the player already lives in the PiP window, and a modal
    /// presentation on top of it would double-present the same controller.
    private(set) var isPictureInPictureActive = false

    /// Publishes full-screen state. `false` is only delivered AFTER the exit
    /// transition has completed, so the orientation lock can return to
    /// portrait without fighting the exit animation.
    var onFullScreenChange: (@MainActor (Bool) -> Void)?
    /// Called when PiP starts, so a modal full-screen can be dismissed.
    var onPictureInPictureStarted: (@MainActor () -> Void)?
    /// Called before PiP starts (also used to drop the modal early).
    var onPictureInPictureWillStart: (@MainActor () -> Void)?
    /// Called when AVKit needs the player UI restored after a full-screen exit.
    var onRestorePlayerUI: (@MainActor () -> Void)?

    // MARK: - Testable entry points (called by the delegate methods below)

    func beginFullScreen(wasPlaying: Bool) {
        // "Playing" means the user intent is playback: paused is the only
        // state where we must NOT resume. While buffering
        // (waitingToPlayAtSpecifiedRate) the transition must still restore
        // playback once the layer is back.
        shouldResumeAfterTransition = wasPlaying
    }

    func endFullScreenTransition(player: AVPlayer?) {
        if shouldResumeAfterTransition {
            player?.play()
        }
    }

    // MARK: - AVPlayerViewControllerDelegate

    func playerViewController(_ playerViewController: AVPlayerViewController,
                              willBeginFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator) {
        beginFullScreen(wasPlaying: (playerViewController.player?.timeControlStatus ?? .paused) != .paused)
        Task { @MainActor in onFullScreenChange?(true) }
        coordinator.animate(alongsideTransition: nil) { [weak self, weak playerViewController] context in
            // If the begin transition was cancelled, no full-screen ever
            // happened — back out of the published state.
            if context.isCancelled {
                Task { @MainActor in self?.onFullScreenChange?(false) }
                return
            }
            self?.endFullScreenTransition(player: playerViewController?.player)
        }
    }

    func playerViewController(_ playerViewController: AVPlayerViewController,
                              willEndFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator) {
        // Capture the state at exit time (a fresh willEnd is not guaranteed
        // to follow a willBegin of this session).
        beginFullScreen(wasPlaying: (playerViewController.player?.timeControlStatus ?? .paused) != .paused)
        coordinator.animate(alongsideTransition: nil) { [weak self, weak playerViewController] context in
            // A cancelled exit (e.g. the landscape lock re-asserted during
            // the transition) must not publish the end of full-screen.
            guard !context.isCancelled else { return }
            // Resume playback first (the layer is back in the render
            // pipeline), then publish the end of full-screen so the view can
            // request portrait AFTER the exit animation completes.
            self?.endFullScreenTransition(player: playerViewController?.player)
            Task { @MainActor in self?.onFullScreenChange?(false) }
        }
    }

    /// AVKit's full-screen is always restored to our inline host.
    func playerViewController(_ playerViewController: AVPlayerViewController,
                              restoreUserInterfaceForFullScreenExitWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
        Task { @MainActor in onRestorePlayerUI?() }
        completionHandler(true)
    }

    // MARK: - PiP

    func playerViewControllerWillStartPictureInPicture(_ playerViewController: AVPlayerViewController) {
        Task { @MainActor in onPictureInPictureWillStart?() }
    }

    func playerViewControllerShouldAutomaticallyDismissAtPictureInPictureStart(_ playerViewController: AVPlayerViewController) -> Bool {
        true
    }

    func playerViewControllerDidStartPictureInPicture(_ playerViewController: AVPlayerViewController) {
        isPictureInPictureActive = true
        Task { @MainActor in onPictureInPictureStarted?() }
    }

    func playerViewControllerDidStopPictureInPicture(_ playerViewController: AVPlayerViewController) {
        isPictureInPictureActive = false
    }

    /// The player is always hosted inline, so restoring the UI is trivial.
    func playerViewController(_ playerViewController: AVPlayerViewController,
                              restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
        completionHandler(true)
    }
}

/// Transient, non-destructive player states surfaced as a lightweight overlay
/// — unlike `errorMessage`, these never hide the video.
enum PlayerActivity: Equatable {
    case reconnecting
    case switchingQuality
}

@MainActor
final class PlayerViewModel: ObservableObject {
    let videoID: String
    let isLive: Bool
    let clipThumbnailURL: URL?

    @Published var player: AVPlayer?
    // Kept nonisolated for deinit cleanup (deinit is always nonisolated)
    nonisolated(unsafe) private var _playerForDeinit: AVPlayer?
    @Published var isLoading: Bool = true
    @Published var errorMessage: String?

    @Published var selectedQuality: String = "auto"

    /// Non-destructive busy state (reconnecting after a stall, preloading a
    /// quality switch). nil when playback is steady.
    @Published var playerActivity: PlayerActivity?

    // MARK: - Seamless recovery (stalls, expired CDN tokens)

    /// Consecutive recovery attempts so far. Reset after 10 min of stable
    /// playback (a long VOD whose CDN token expires at minute 45 must still
    /// have its full retry budget).
    private(set) var recoveryAttempts = 0
    private let maxRecoveryAttempts = 3
    /// Internal for tests: last time a recovery was attempted.
    var lastRecoveryDate: Date?
    private(set) var isRecovering = false
    private var recoveryTask: Task<Void, Never>?
    private var stallWatchdog: Task<Void, Never>?

    /// Test seam: replaces network URL resolution during recovery.
    var resolveStreamURLOverride: (() async throws -> URL)?
    /// Test seam: backoff before attempt N (1-based). Zero in tests.
    var recoveryBackoffNanoseconds: (Int) -> UInt64 = { UInt64($0) * 2_000_000_000 }
    /// Test seam: delay before a stall is considered unrecoverable by itself.
    var stallWatchdogNanoseconds: UInt64 = 8_000_000_000

    /// Generation counter: a slow quality switch must never overwrite the
    /// item installed by a newer one.
    private var qualityChangeGeneration = 0

    let localPlaylistPath: String?

    /// The single `NSVPlayerViewController` shared between inline and
    /// full-screen presentations. Presenting the same instance (modal or
    /// AVKit native) never rebuilds the player layer — the root cause of the
    /// full-screen "jump", "pause" and "black zone" regressions.
    @Published private(set) var playerController: NSVPlayerViewController?

    /// Unified full-screen state: true while EITHER the modal presentation
    /// (`enterFullScreen`) or AVKitʼs native full-screen (toolbar button) is
    /// active. Drives the scene's orientation lock in PlayerView.
    @Published var isFullScreen = false
    private let fullscreenDelegate = PlayerFullscreenDelegate()
    /// The UIKit host that presents the modal full-screen. Weak: the host is
    /// owned by SwiftUI and must not outlive the view model.
    private weak var host: PlayerHostViewController?
    /// A full-screen entry requested before the presentation was possible
    /// (stream still loading, controller not yet in a window).
    private var pendingFullScreenEntry = false

    var liveChatService: TwitchChatService?
    var vodChatService: VODChatService?

    /// Metadata used to feed the Control Center media widget (Now Playing).
    private var nowPlayingMetadata: VideoMetadata?
    /// Ownership token for the current Now Playing session (see
    /// `NowPlayingManager.teardown(owner:)`).
    private var nowPlayingOwner: UUID?

    // MARK: - Full-screen (modal presentation)

    /// Called by the inline `CustomVideoPlayer` once its host view controller
    /// exists, so the view model can present/dismiss the modal full-screen.
    func setHost(_ host: PlayerHostViewController) {
        self.host = host
    }

    /// Rotation-driven entry: presents the shared player full-screen as a
    /// UIKit modal. No-op if a full-screen (modal or AVKit native) is already
    /// active, or if the host isn't on screen yet. If the presentation can't
    /// start yet (e.g. the user rotated while the stream was still loading),
    /// the entry is remembered and consumed by `consumePendingFullScreenEntry`.
    func enterFullScreen() {
        // No-op while PiP owns the player — presenting the modal full-screen
        // over the PiP window would double-present the shared controller.
        guard !isFullScreen, !fullscreenDelegate.isPictureInPictureActive, let host else { return }
        if host.presentFullScreen() {
            setFullScreen(true)
        } else {
            pendingFullScreenEntry = true
        }
    }

    /// Consumes a deferred full-screen entry — called when the player
    /// controller becomes available, and on every player screen appear.
    func consumePendingFullScreenEntry() {
        guard pendingFullScreenEntry, !isFullScreen, let host else { return }
        pendingFullScreenEntry = false
        if host.presentFullScreen() {
            setFullScreen(true)
        }
    }

    /// Programmatic exit of the MODAL presentation only (e.g. when PiP starts).
    /// AVKit's native full-screen is exited through its own toolbar button.
    func exitFullScreen() {
        guard isFullScreen, let host else { return }
        host.exitFullScreen()
    }

    /// Portrait rotation while full-screen must NOT exit — re-assert the
    /// landscape lock so neither the modal nor AVKit's full-screen window
    /// rotates away. The user exits only with the full-screen button.
    func reassertLandscapeIfFullScreen() {
        guard isFullScreen else { return }
        applyOrientationLock(.landscape)
    }

    /// Called by the host synchronously BEFORE presenting the modal —
    /// locking landscape first avoids a mid-transition rotation jump.
    func prepareForFullScreenEntry() {
        applyOrientationLock(.landscape)
    }

    /// Single mutation point for the full-screen state: every transition
    /// also (re)applies the orientation lock, so the scene geometry always
    /// follows the presentation state.
    private func setFullScreen(_ value: Bool) {
        guard isFullScreen != value else { return }
        isFullScreen = value
        applyOrientationLock(value ? .landscape : .portrait)
    }

    /// Locks the scene to a single orientation. iPhone only — on iPad the
    /// system rotation is left alone (split view etc.). Failures are silent.
    private func applyOrientationLock(_ mask: UIInterfaceOrientationMask) {
        guard UIDevice.current.userInterfaceIdiom == .phone,
              let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
    }

    @Published var chatMessages: [ChatMessage] = []
    /// Erreur d'envoi du chat live (NOTICE serveur, non connecté…).
    @Published var chatSendError: String?

    /// Reconnecte le chat live avec les identifiants à jour (après un login).
    func reconnectChatIfNeeded() {
        guard isLive, let service = liveChatService else { return }
        service.connect(channel: videoID)
    }

    /// Envoie un message dans le chat live. Retourne false si rien n'est parti
    /// (non connecté, texte vide) — l'erreur est publiée dans chatSendError.
    func sendChatMessage(_ text: String) -> Bool {
        liveChatService?.sendChatMessage(text) ?? false
    }
    private var cancellables = Set<AnyCancellable>()
    private var playerItemCancellables = Set<AnyCancellable>()
    // Retain TSPlayerItem (owns the local HTTP server) for the entire playback session.
    // Without this, the server is deallocated as soon as makePlayerItem() returns, causing -1004.
    private var currentTSPlayerItem: TSPlayerItem?
    // Retain AdStrippingProxy for the playback session (same reason as above).
    private var currentProxy: AdStrippingProxy?
    /// The external proxy resolved for this playback session (configured URL,
    /// cached auto-discovered proxy, or a fresh scrape). nil → plain local
    /// stripping, the fallback when nothing usable.
    private var currentExternalProxy: HTTPProxy?
    nonisolated(unsafe) var timeObserver: Any?

    var onTimeUpdate: ((Int, Int) -> Void)?
    var initialTimecode: Int = 0

    /// One-shot fallback state: if playback through the external TTV proxy
    /// fails (proxy down, rate-limited, or serving unplayable playlists), we
    /// retry exactly once with local ad blocking instead of surfacing a
    /// cryptic AVPlayer error.
    private var adBlockModeOverride: AdBlockMode?
    private var didFallbackFromTTV = false

    /// The effective ad-block mode — the user setting, unless a fallback
    /// override kicked in for this playback session.
    private func resolvedAdBlockMode() -> AdBlockMode {
        if let adBlockModeOverride { return adBlockModeOverride }
        return AdBlockMode(rawValue: UserDefaults.standard.string(forKey: "adBlockMode") ?? AdBlockMode.local.rawValue) ?? .local
    }

    /// Resolves the proxy for `.external` mode, in order:
    /// 1. the user-configured URL, if it validates,
    /// 2. the last auto-discovered free proxy, if it still works,
    /// 3. a fresh scrape of the ad-free country lists (spys.one).
    /// Returns nil when nothing works — the caller falls back to `.local`.
    private func resolveExternalProxy() async -> HTTPProxy? {
        // 1. User-configured proxy.
        let userProxy = ExternalProxyService.parse(UserDefaults.standard.string(forKey: "externalProxyURL") ?? "")
        if let userProxy, case .ok = await ExternalProxyService.validate(userProxy).status {
            AppLogger.shared.log("🛡 External proxy: using configured \(userProxy.host):\(userProxy.port)")
            return userProxy
        }
        // 2. Last auto-discovered proxy, if it still exits ad-free.
        let cached = UserDefaults.standard.string(forKey: "externalProxyLastGood")
            .flatMap(ExternalProxyService.parse)
        if let cached, case .ok = await ExternalProxyService.validate(cached).status {
            AppLogger.shared.log("🛡 External proxy: using cached \(cached.host):\(cached.port)")
            return cached
        }
        // 3. Scrape the ad-free lists and validate candidates end-to-end.
        let candidates = await ProxyScraperService.fetchCandidates()
        if let found = await ProxyScraperService.findFirstValid(candidates) {
            UserDefaults.standard.set("\(found.host):\(found.port)", forKey: "externalProxyLastGood")
            AppLogger.shared.log("🛡 External proxy: auto-discovered \(found.host):\(found.port)")
            return found
        }
        AppLogger.shared.log("🛡 External proxy: no usable proxy found")
        return nil
    }

    init(videoID: String, isLive: Bool, clipThumbnailURL: URL? = nil, localPlaylistPath: String? = nil) {
        self.videoID = videoID
        self.isLive = isLive
        self.clipThumbnailURL = clipThumbnailURL
        self.localPlaylistPath = localPlaylistPath

        if isLive {
            let service = TwitchChatService()
            service.connect(channel: videoID)
            self.liveChatService = service
            service.$messages
                .receive(on: DispatchQueue.main)
                .assign(to: &$chatMessages)
            service.$lastSendError
                .receive(on: DispatchQueue.main)
                .assign(to: &$chatSendError)
        } else {
            let service = VODChatService(videoID: videoID)
            self.vodChatService = service
            service.$messages
                .receive(on: DispatchQueue.main)
                .assign(to: &$chatMessages)
        }
    }

    deinit {
        recoveryTask?.cancel()
        stallWatchdog?.cancel()
        if let observer = timeObserver, let p = _playerForDeinit {
            p.removeTimeObserver(observer)
        }
        // Leaving the player screen stops playback (AVPlayer is thread-safe;
        // deinit is nonisolated).
        _playerForDeinit?.pause()
        liveChatService?.disconnect()
        if let owner = nowPlayingOwner {
            Task { @MainActor in
                // Clear the media widget when the player screen is closed —
                // only if this session is still the widget's current one.
                NowPlayingManager.shared.teardown(owner: owner)
            }
        }
    }

    // MARK: - Now Playing (Control Center media widget)

    /// Called by PlayerView on appear with the screen's metadata. The media
    /// widget is fed once the player exists (or immediately, if it already
    /// does — e.g. after a TTV fallback reload).
    func configureNowPlaying(metadata: VideoMetadata?) {
        nowPlayingMetadata = metadata
        configureNowPlayingIfReady()
    }

    private func configureNowPlayingIfReady() {
        guard let player else { return }
        let metadata = NowPlayingMetadata(
            title: nowPlayingMetadata?.title ?? (isLive ? String(localized: "Live Stream") : "VOD"),
            artist: nowPlayingMetadata?.streamerName ?? videoID,
            album: nowPlayingMetadata?.gameName,
            artworkURL: nowPlayingMetadata?.previewThumbnailURL ?? clipThumbnailURL,
            isLive: isLive
        )
        nowPlayingOwner = NowPlayingManager.shared.configure(player: player, metadata: metadata)
    }

    func loadStream(force: Bool = false) {
        // Idempotence: a duplicate onAppear (view re-creation, tab re-selection)
        // must never tear down a healthy session — replacing the item would cut
        // playback. Fallbacks (TTV proxy, error reload) pass force: true.
        if !force, player != nil, errorMessage == nil {
            AppLogger.shared.log("🎬 loadStream skipped — session already active")
            return
        }

        // A fresh load supersedes any recovery in flight and restores the
        // full retry budget.
        recoveryTask?.cancel()
        stallWatchdog?.cancel()
        isRecovering = false
        recoveryAttempts = 0
        if playerActivity == .reconnecting { playerActivity = nil }

        isLoading = true
        errorMessage = nil

        Task {
            do {
                // .external: resolve a working proxy (configured URL, cached
                // auto-discovered proxy, or a fresh scrape of the ad-free
                // lists) before burning a playback on it — a dead proxy would
                // 502 every fetch. On failure, fall back to local stripping
                // for this session.
                if resolvedAdBlockMode() == .external {
                    currentExternalProxy = await resolveExternalProxy()
                    if currentExternalProxy == nil {
                        adBlockModeOverride = .local
                        AppLogger.shared.log("🛡 External proxy: none usable — falling back to local")
                    }
                }
                let url = try await resolveStreamURL()
                let playerItem = makePlayerItem(url: url)

                if self.player == nil {
                    let newPlayer = AVPlayer(playerItem: playerItem)
                    self.player = newPlayer
                    self._playerForDeinit = newPlayer
                    self.setupTimeObserver()

                    // Create the shared player view controller once. Both
                    // full-screen paths — our modal presentation and AVKit's
                    // native full-screen button — use this same instance, so
                    // the layer is never rebuilt across transitions.
                    if self.playerController == nil {
                        let controller = NSVPlayerViewController()
                        controller.player = newPlayer
                        controller.allowsPictureInPicturePlayback = true
                        // Auto-start PiP when the app goes to the background —
                        // watching continues in the floating window.
                        controller.canStartPictureInPictureAutomaticallyFromInline = true
                        controller.delegate = self.fullscreenDelegate
                        controller.onDismissed = { [weak self] in
                            // Modal full-screen closed (Done button).
                            self?.setFullScreen(false)
                        }
                        self.fullscreenDelegate.onFullScreenChange = { [weak self] active in
                            self?.setFullScreen(active)
                        }
                        self.fullscreenDelegate.onPictureInPictureWillStart = { [weak self] in
                            // PiP is taking over — drop the modal full-screen.
                            self?.exitFullScreen()
                        }
                        self.fullscreenDelegate.onPictureInPictureStarted = { [weak self] in
                            self?.exitFullScreen()
                        }
                        self.fullscreenDelegate.onRestorePlayerUI = { [weak self] in
                            // AVKit asks for the player UI back after a
                            // full-screen exit — re-home the controller.
                            self?.host?.reattach()
                        }
                        self.playerController = controller
                        self.configureNowPlayingIfReady()
                    }
                } else {
                    self.player?.replaceCurrentItem(with: playerItem)
                }

                self.setupPlayerItemObservers(playerItem)

                if self.initialTimecode > 0 {
                    let time = CMTime(seconds: Double(self.initialTimecode), preferredTimescale: 1000)
                    self.player?.seek(to: time) { [weak self] finished in
                        Task { @MainActor in
                            // A cancelled seek (superseded by a newer one) must
                            // not resume playback at a stale position.
                            guard finished else { return }
                            self?.player?.play()
                        }
                    }
                } else if playerItem.status == .readyToPlay {
                    self.player?.play()
                } else {
                    var observer: NSKeyValueObservation?
                    observer = playerItem.observe(\.status, options: [.new]) { [weak self] item, _ in
                        guard let self else {
                            observer?.invalidate()
                            return
                        }
                        switch item.status {
                        case .readyToPlay:
                            Task { @MainActor [weak self] in self?.player?.play() }
                            observer?.invalidate()
                        case .failed:
                            observer?.invalidate()
                        default:
                            break
                        }
                    }
                }
                self.isLoading = false
            } catch {
                AppLogger.shared.log("Failed to load stream: \(error)")
                self.errorMessage = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    private func resolveStreamURL() async throws -> URL {
        if let localPath = localPlaylistPath {
            let documentsPath = FileManager.documentsDirectory
            let vodDirectory = documentsPath.appendingPathComponent(localPath).deletingLastPathComponent()

            // Priority: index.m3u8 (fMP4) → video_000.ts (multi-file TS) → video.ts (legacy TS) → video.mp4 → raw path
            for filename in ["index.m3u8", "video_000.ts", "video.ts", "video.mp4"] {
                let url = vodDirectory.appendingPathComponent(filename)
                if FileManager.default.fileExists(atPath: url.path) { return url }
            }
            let localURL = documentsPath.appendingPathComponent(localPath)
            if FileManager.default.fileExists(atPath: localURL.path) { return localURL }
            throw URLError(.fileDoesNotExist)
        } else if let clipThumb = clipThumbnailURL {
            var urlString = clipThumb.absoluteString
            if let range = urlString.range(of: "-preview-") {
                urlString = String(urlString[..<range.lowerBound]) + ".mp4"
            }
            return URL(string: urlString) ?? clipThumb
        } else {
            let ttvURL: String?
            let mode = resolvedAdBlockMode()
            if mode == .ttv {
                ttvURL = UserDefaults.standard.string(forKey: "ttvProxyURL") ?? "https://api.ttv.lol"
            } else {
                ttvURL = nil
            }
            return try await TwitchHLSManager.shared.fetchPlaylistURL(
                videoID: videoID,
                isLive: isLive,
                quality: selectedQuality,
                ttvProxyURL: ttvURL
            )
        }
    }

    private func makePlayerItem(url: URL) -> AVPlayerItem {
        let item = buildPlayerItem(url: url)
        // Buffering policy (remote content only):
        // - VODs get a generous 30 s forward buffer so network jitter never
        //   surfaces as a rebuffer; live keeps AVKit's low-latency defaults.
        // - On cellular, capping the peak bitrate steers adaptive selection
        //   toward variants the link can actually sustain.
        if !url.isFileURL {
            if !isLive {
                item.preferredForwardBufferDuration = 30
            }
            if NetworkMonitor.shared.isCellular {
                item.preferredPeakBitRate = 2_000_000
            }
        }
        return item
    }

    private func buildPlayerItem(url: URL) -> AVPlayerItem {
        if url.isFileURL, url.pathExtension == "m3u8" {
            // Chaîne de fallback: chaque mode de lecture essayé en séquence, l'échec d'un mode est prévu
            if let tsItem = try? TSPlayerItem(fmp4Directory: url.deletingLastPathComponent()) {
                currentTSPlayerItem = tsItem
                return tsItem.playerItem
            }
        }

        if url.pathExtension == "ts" {
            let vodDirectory = url.deletingLastPathComponent()
            if let data = try? Data(contentsOf: vodDirectory.appendingPathComponent("video.segments.json")),
               let segments = try? JSONDecoder().decode([SegmentInfo].self, from: data), !segments.isEmpty {
                if segments.contains(where: { $0.file != nil }),
                   let tsItem = try? TSPlayerItem(tsFilesDirectory: vodDirectory, segments: segments) {
                    currentTSPlayerItem = tsItem
                    return tsItem.playerItem
                }
                if let tsItem = try? TSPlayerItem(tsFileURL: url, segments: segments) {
                    currentTSPlayerItem = tsItem
                    return tsItem.playerItem
                }
            }
            let duration = (try? String(contentsOf: vodDirectory.appendingPathComponent("video.duration")))
                .flatMap { Double($0.trimmingCharacters(in: .whitespacesAndNewlines)) } ?? 10_800.0
            if let tsItem = try? TSPlayerItem(tsFileURL: url, totalDuration: duration) {
                currentTSPlayerItem = tsItem
                return tsItem.playerItem
            }
        }

        if url.isFileURL {
            return AVPlayerItem(asset: AVURLAsset(url: url))
        }

        // Ad-blocking proxy for remote HLS streams. Every non-disabled mode
        // goes through the local AdStrippingProxy:
        // - .local: the proxy fetches from usher/CDN and strips ads itself.
        // - .external: same local proxy, but the fetcher relays every request
        //   through a user-configured HTTP proxy in an ad-free country — Twitch
        //   then serves no ads at all, and stripping is only a fallback.
        // - .ttv:   the URL already points at the external TTV proxy (server-side
        //           blocking), but its responses pass LL-HLS signaling through
        //           untouched (CAN-BLOCK-RELOAD, PRELOAD-HINT, …) — the cause of
        //           the HLS-FASB / ICY PUMP playback failures. The local proxy
        //           normalizes the playlist for AVPlayer and strips any residual
        //           ad segments the external proxy let through (e.g. VODs, which
        //           TTV proxies never clean).
        let mode = resolvedAdBlockMode()
        if mode != .disabled, !url.isFileURL {
            let ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
            // .external: relay every upstream request through the proxy
            // resolved for this session (configured URL, cached or freshly
            // scraped free proxy) so Twitch inserts no ads. nil proxy =
            // plain local stripping — the fallback when nothing usable.
            let proxy: HTTPProxy?
            if mode == .external {
                proxy = currentExternalProxy
                    ?? ExternalProxyService.parse(UserDefaults.standard.string(forKey: "externalProxyURL") ?? "")
            } else {
                proxy = nil
            }
            let fetcher = RemotePlaylistFetcher(
                userAgent: ua,
                extraHeaders: ["Client-Id": TwitchAPIService.shared.webClientId],
                proxy: proxy
            )
            if let proxy = try? AdStrippingProxy(remoteURL: url, fetcher: fetcher) {
                currentProxy?.stop()
                currentProxy = proxy
                return AVPlayerItem(asset: AVURLAsset(url: proxy.localURL))
            }
        }

        let headers = ["User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"]
        return AVPlayerItem(asset: AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers]))
    }

    private func setupPlayerItemObservers(_ playerItem: AVPlayerItem) {
        playerItemCancellables.removeAll()

        playerItem.publisher(for: \.status)
            .receive(on: RunLoop.main)
            .sink { [weak self] status in
                guard let self else { return }
                switch status {
                case .failed:
                    let detail = playerItem.errorLog()?.events.last
                    let msg = "\(playerItem.error?.localizedDescription ?? "?"), \(detail?.errorComment ?? "") (\(detail?.errorStatusCode ?? 0))"
                    AppLogger.shared.log("🎬 AVPlayerItem FAILED: \(msg)")

                    // One-shot recovery: if the external proxy (.ttv or the
                    // .external HTTP proxy) let us down (outage, rate limiting,
                    // unplayable playlist), retry once with local ad blocking
                    // rather than dying on the error.
                    if [.ttv, .external].contains(self.resolvedAdBlockMode()),
                       !self.didFallbackFromTTV,
                       self.localPlaylistPath == nil,
                       self.clipThumbnailURL == nil {
                        self.didFallbackFromTTV = true
                        self.adBlockModeOverride = .local
                        AppLogger.shared.log("🛡 TTV proxy playback failed — falling back to local ad blocking")
                        self.loadStream(force: true)
                        return
                    }

                    // Mid-playback failure (expired CDN token, dropped
                    // connection): try to resume in place before surfacing
                    // the blocking error UI.
                    if self.localPlaylistPath == nil, self.clipThumbnailURL == nil {
                        self.attemptSeamlessRecovery(reason: "item failed (\(detail?.errorStatusCode ?? 0))")
                    } else {
                        self.errorMessage = playerItem.error?.localizedDescription
                    }
                case .readyToPlay:
                    let dur = playerItem.duration.seconds
                    AppLogger.shared.log("🎬 AVPlayerItem READY — duration: \(dur)s")

                    // Detect broken TTV proxy responses: the player item reports
                    // "ready" but the duration is NaN (unparseable timeline) and
                    // playback never starts. Trigger the same one-shot fallback.
                    if dur.isNaN,
                       !self.isLive,
                       [.ttv, .external].contains(self.resolvedAdBlockMode()),
                       !self.didFallbackFromTTV,
                       self.localPlaylistPath == nil,
                       self.clipThumbnailURL == nil {
                        self.didFallbackFromTTV = true
                        self.adBlockModeOverride = .local
                        AppLogger.shared.log("🛡 TTV proxy returned unplayable stream (NaN duration) — falling back to local")
                        self.loadStream(force: true)
                        return
                    }
                case .unknown: break
                @unknown default: break
                }
            }
            .store(in: &playerItemCancellables)

        for (name, handler) in [
            (Notification.Name.AVPlayerItemFailedToPlayToEndTime, { [weak self] (n: Notification) in
                let err = n.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
                AppLogger.shared.log("🎬 FailedToPlayToEndTime: \(err?.localizedDescription ?? "?")")
                // The stream died mid-playback (network drop, expired token) —
                // resume in place instead of leaving a frozen frame.
                self?.attemptSeamlessRecovery(reason: "failedToPlayToEndTime")
            }),
            (Notification.Name.AVPlayerItemPlaybackStalled, { [weak self] (_: Notification) in
                self?.scheduleStallWatchdog()
            }),
            (Notification.Name.AVPlayerItemNewErrorLogEntry, { [weak self] _ in
                if let e = playerItem.errorLog()?.events.last {
                    AppLogger.shared.log("🎬 ErrorLog: \(e.errorComment ?? "") (\(e.errorStatusCode)) — \(e.uri ?? "")")
                    // 403/410 = expired CDN token. Recover proactively, before
                    // the item gives up entirely.
                    if e.errorStatusCode == 403 || e.errorStatusCode == 410 {
                        self?.attemptSeamlessRecovery(reason: "HTTP \(e.errorStatusCode)")
                    }
                }
            }),
        ] {
            NotificationCenter.default.publisher(for: name, object: playerItem)
                .receive(on: DispatchQueue.main)
                .sink { handler($0) }
                .store(in: &playerItemCancellables)
        }
    }

    // MARK: - Seamless recovery

    /// A stall is only a problem if it persists: brief rebuffering resolves
    /// itself. After `stallWatchdogNanoseconds` with the player still waiting
    /// (never when user-paused), kick a seamless recovery.
    private func scheduleStallWatchdog() {
        stallWatchdog?.cancel()
        stallWatchdog = Task { [weak self] in
            try? await Task.sleep(nanoseconds: stallWatchdogNanoseconds)
            guard let self, !Task.isCancelled else { return }
            guard let player = self.player,
                  player.timeControlStatus == .waitingToPlayAtSpecifiedRate else { return }
            self.attemptSeamlessRecovery(reason: "prolonged stall")
        }
    }

    /// In-place playback recovery: re-resolves the stream URL (fresh CDN
    /// token), swaps the item and resumes exactly where playback stopped.
    /// The video freezes briefly instead of dying. Retries with backoff; the
    /// blocking error UI only appears once the budget is exhausted.
    func attemptSeamlessRecovery(reason: String) {
        // Local files and clips can't expire or be re-resolved — nothing to do.
        guard localPlaylistPath == nil, clipThumbnailURL == nil else { return }
        guard !isRecovering else { return }

        // Refill the budget after 10 min of stable playback.
        if let last = lastRecoveryDate, Date().timeIntervalSince(last) > 600 {
            recoveryAttempts = 0
        }
        recoveryAttempts += 1
        lastRecoveryDate = Date()

        guard recoveryAttempts <= maxRecoveryAttempts else {
            AppLogger.shared.log("🎬 Recovery aborted (\(reason)) — budget exhausted")
            playerActivity = nil
            errorMessage = String(localized: "Playback failed. Check your connection and try again.")
            return
        }

        isRecovering = true
        playerActivity = .reconnecting
        AppLogger.shared.log("🎬 Seamless recovery #\(recoveryAttempts) (\(reason))")

        // VOD: resume where we stopped. Live: the fresh item rejoins the edge.
        let resumePosition: Double? = isLive ? nil : player?.currentTime().seconds
        let attempt = recoveryAttempts

        recoveryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: recoveryBackoffNanoseconds(attempt))
            guard let self, !Task.isCancelled else { return }
            do {
                // `??` ne supporte pas l'await côté droit (autoclosure).
                let url: URL
                if let override = self.resolveStreamURLOverride {
                    url = try await override()
                } else {
                    url = try await self.resolveStreamURL()
                }
                let item = self.makePlayerItem(url: url)
                self.setupPlayerItemObservers(item)
                self.player?.replaceCurrentItem(with: item)

                if let resumePosition, resumePosition > 0 {
                    let time = CMTime(seconds: resumePosition, preferredTimescale: 600)
                    self.player?.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
                        Task { @MainActor [weak self] in
                            guard let self else { return }
                            if finished { self.player?.play() }
                            self.isRecovering = false
                            self.playerActivity = nil
                        }
                    }
                } else {
                    self.player?.play()
                    self.isRecovering = false
                    self.playerActivity = nil
                }
            } catch {
                AppLogger.shared.log("🎬 Recovery #\(attempt) failed: \(error.localizedDescription)")
                self.isRecovering = false
                self.playerActivity = nil
                // Chain into the next attempt (longer backoff) — or the error
                // UI once the budget is exhausted.
                self.attemptSeamlessRecovery(reason: reason)
            }
        }
    }

    /// Waits for an item to become playable WITHOUT touching the current one.
    /// Returns false on failure or timeout — the caller keeps the old stream.
    private func waitUntilReady(_ item: AVPlayerItem, timeoutNanoseconds: UInt64 = 12_000_000_000) async -> Bool {
        if item.status == .readyToPlay { return true }
        return await withTaskGroup(of: Bool.self) { group in
            group.addTask {
                for await _ in item.publisher(for: \.status).values {
                    switch item.status {
                    case .readyToPlay: return true
                    case .failed: return false
                    default: continue
                    }
                }
                return false
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: timeoutNanoseconds)
                return false
            }
            let result = await group.next() ?? false
            group.cancelAll()
            return result
        }
    }

    private enum QualitySwitchError: Error { case preloadFailed }

    private func setupTimeObserver() {
        guard !isLive, timeObserver == nil else { return }
        let interval = CMTime(seconds: 5, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
        timeObserver = player?.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            let seconds = time.seconds
            if seconds > 0 {
                Task { @MainActor in
                    self?.vodChatService?.fetchChat(at: seconds)
                    if let duration = self?.player?.currentItem?.duration.seconds, duration.isFinite {
                        self?.onTimeUpdate?(Int(seconds), Int(duration))
                    }
                }
            }
        }
    }

    func changeQuality(to newQuality: String) {
        guard newQuality != selectedQuality else { return }
        guard localPlaylistPath == nil, clipThumbnailURL == nil else { return }

        let previousQuality = selectedQuality
        // Sub-second capture: seeking to a truncated Int would visibly jump.
        let currentSeconds = player?.currentTime().seconds ?? 0
        let resumePosition: Double? = (!isLive && currentSeconds > 0) ? currentSeconds : nil
        if let resumePosition {
            initialTimecode = Int(resumePosition)
        }

        selectedQuality = newQuality
        playerActivity = .switchingQuality
        qualityChangeGeneration += 1
        let generation = qualityChangeGeneration

        // Resolve ad-block mode so .ttv gets the proxy URL — same as resolveStreamURL.
        let mode = resolvedAdBlockMode()
        let ttvURL: String?
        if mode == .ttv {
            ttvURL = UserDefaults.standard.string(forKey: "ttvProxyURL") ?? "https://api.ttv.lol"
        } else {
            ttvURL = nil
        }

        Task {
            do {
                let url = try await TwitchHLSManager.shared.fetchPlaylistURL(
                    videoID: videoID,
                    isLive: isLive,
                    quality: newQuality,
                    ttvProxyURL: ttvURL
                )
                let newItem = makePlayerItem(url: url)

                // Preload: the OLD item keeps rendering until the new one is
                // ready — the swap then costs ~1 frame instead of a full
                // rebuffer with a black screen.
                guard await waitUntilReady(newItem) else {
                    throw QualitySwitchError.preloadFailed
                }
                // A newer quality change owns the player now — discard.
                guard generation == qualityChangeGeneration else { return }

                setupPlayerItemObservers(newItem)
                player?.replaceCurrentItem(with: newItem)

                if let resumePosition {
                    let time = CMTime(seconds: resumePosition, preferredTimescale: 600)
                    player?.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
                        Task { @MainActor in
                            guard finished else { return }
                            self?.player?.play()
                        }
                    }
                } else {
                    player?.play()
                }
                if generation == qualityChangeGeneration {
                    playerActivity = nil
                }
            } catch {
                // Preload or swap failed: the previous item was never touched,
                // so playback continues uninterrupted on the old quality.
                AppLogger.shared.log("Failed to change quality: \(error)")
                if generation == qualityChangeGeneration {
                    playerActivity = nil
                    selectedQuality = previousQuality
                }
            }
        }
    }

    // MARK: - Segment Selection & Download

    @Published var isSegmentSelectionMode = false
    @Published var startTimecode: Int?
    @Published var endTimecode: Int?
    @Published var showSegmentSuccess = false
    @Published var isDownloadSheetPresented = false
    @Published var selectedSegmentQuality = "chunked"

    var currentTimeSeconds: Int {
        guard let player else { return 0 }
        return Int(player.currentTime().seconds)
    }

    func setStartTimecode() {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
            startTimecode = currentTimeSeconds
            checkSegmentSelection()
        }
    }

    func setEndTimecode() {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
            endTimecode = currentTimeSeconds
            checkSegmentSelection()
        }
    }

    private func checkSegmentSelection() {
        guard let start = startTimecode, let end = endTimecode else { return }
        isSegmentSelectionMode = false
        showSegmentSuccess = true
        isDownloadSheetPresented = true

        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            guard let self else { return }
            self.isDownloadSheetPresented = false
            self.showSegmentSuccess = false

            let minTime = min(start, end)
            let maxTime = max(start, end)
            self.onSegmentDownloadRequested?(minTime, maxTime, self.selectedSegmentQuality)
        }
    }

    var onSegmentDownloadRequested: ((_ start: Int, _ end: Int, _ quality: String) -> Void)?
}
