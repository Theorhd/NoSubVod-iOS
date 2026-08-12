import Foundation
import AVFoundation
import AVKit
import Combine
import SwiftUI
import TSPlayerKit

// MARK: - Native fullscreen delegate

/// Tracks whether UIKitʼs own full-screen presentation (the button in the
/// AVPlayerViewController toolbar) is active, so we never open a SwiftUI
/// cover on top of it — and thus never have two full-screen players stacked.
final class PlayerFullscreenDelegate: NSObject, AVPlayerViewControllerDelegate, @unchecked Sendable {
    var onFullScreenChange: (@MainActor (Bool) -> Void)?

    func playerViewController(_ playerViewController: AVPlayerViewController,
                              willBeginFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator) {
        Task { @MainActor in onFullScreenChange?(true) }
    }

    func playerViewController(_ playerViewController: AVPlayerViewController,
                              willEndFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator) {
        Task { @MainActor in onFullScreenChange?(false) }
    }
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
    @Published var showQualityMenu: Bool = false
    private var qualityMenuTask: Task<Void, Never>?

    let localPlaylistPath: String?

    /// The single `AVPlayerViewController` shared between inline and full-screen
    /// presentations. Reparenting the same instance avoids re-creating the player
    /// layer — the root cause of the full-screen "jump" on rotation.
    @Published private(set) var playerController: AVPlayerViewController?

    /// `true` while UIKitʼs native full-screen presentation is on screen.
    /// Gating the SwiftUI cover on this flag prevents double-full-screen races.
    @Published var isNativeFullScreen = false
    private let fullscreenDelegate = PlayerFullscreenDelegate()

    var liveChatService: TwitchChatService?
    var vodChatService: VODChatService?

    @Published var chatMessages: [ChatMessage] = []
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
        } else {
            let service = VODChatService(videoID: videoID)
            self.vodChatService = service
            service.$messages
                .receive(on: DispatchQueue.main)
                .assign(to: &$chatMessages)
        }
    }

    deinit {
        if let observer = timeObserver, let p = _playerForDeinit {
            p.removeTimeObserver(observer)
        }
        liveChatService?.disconnect()
    }

    func loadStream() {
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

                    // Create the shared AVPlayerViewController once, configure
                    // the native-fullscreen delegate so we can gate the SwiftUI
                    // cover and avoid double-presentation races.
                    if self.playerController == nil {
                        let controller = AVPlayerViewController()
                        controller.player = newPlayer
                        controller.allowsPictureInPicturePlayback = true
                        controller.delegate = self.fullscreenDelegate
                        self.fullscreenDelegate.onFullScreenChange = { [weak self] active in
                            self?.isNativeFullScreen = active
                        }
                        self.playerController = controller
                    }
                } else {
                    self.player?.replaceCurrentItem(with: playerItem)
                }

                self.setupPlayerItemObservers(playerItem)

                if self.initialTimecode > 0 {
                    let time = CMTime(seconds: Double(self.initialTimecode), preferredTimescale: 1000)
                    self.player?.seek(to: time) { [weak self] _ in
                        Task { @MainActor in
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
                extraHeaders: ["Client-Id": TwitchAPIService.shared.clientId],
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
                        self.loadStream()
                        return
                    }

                    self.errorMessage = playerItem.error?.localizedDescription
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
                        self.loadStream()
                        return
                    }
                case .unknown: break
                @unknown default: break
                }
            }
            .store(in: &playerItemCancellables)

        for (name, handler) in [
            (Notification.Name.AVPlayerItemFailedToPlayToEndTime, { (n: Notification) in
                let err = n.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
                AppLogger.shared.log("🎬 FailedToPlayToEndTime: \(err?.localizedDescription ?? "?")")
            }),
            (Notification.Name.AVPlayerItemNewErrorLogEntry, { n in
                if let e = playerItem.errorLog()?.events.last {
                    AppLogger.shared.log("🎬 ErrorLog: \(e.errorComment ?? "") (\(e.errorStatusCode)) — \(e.uri ?? "")")
                }
            }),
        ] {
            NotificationCenter.default.publisher(for: name, object: playerItem)
                .receive(on: DispatchQueue.main)
                .sink { handler($0) }
                .store(in: &playerItemCancellables)
        }
    }

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

        if !isLive, let currentTime = player?.currentTime().seconds, currentTime > 0 {
            self.initialTimecode = Int(currentTime)
        }

        self.selectedQuality = newQuality
        self.isLoading = true

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
                let playerItem = makePlayerItem(url: url)

                self.setupPlayerItemObservers(playerItem)
                self.player?.replaceCurrentItem(with: playerItem)

                if !self.isLive && self.initialTimecode > 0 {
                    let time = CMTime(seconds: Double(self.initialTimecode), preferredTimescale: 1000)
                    self.player?.seek(to: time) { [weak self] _ in
                        Task { @MainActor in
                            self?.player?.play()
                        }
                    }
                } else {
                    self.player?.play()
                }
                self.isLoading = false
            } catch {
                AppLogger.shared.log("Failed to change quality: \(error)")
                self.errorMessage = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    func resetQualityMenuTimer() {
        qualityMenuTask?.cancel()
        if showQualityMenu {
            qualityMenuTask = Task {
                // Annulation ignorée volontairement: la tentative doit continuer
                try? await Task.sleep(nanoseconds: 3_500_000_000)
                if !Task.isCancelled {
                    self.showQualityMenu = false
                }
            }
        }
    }

    func toggleQualityMenu() {
        showQualityMenu.toggle()
        resetQualityMenuTimer()
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
