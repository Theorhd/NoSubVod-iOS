import Foundation
import AVFoundation
import Combine
import SwiftUI
import TSPlayerKit

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
    nonisolated(unsafe) var timeObserver: Any?

    var onTimeUpdate: ((Int, Int) -> Void)?
    var initialTimecode: Int = 0

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
                let url = try await resolveStreamURL()
                let playerItem = makePlayerItem(url: url)

                if self.player == nil {
                    let newPlayer = AVPlayer(playerItem: playerItem)
                    self.player = newPlayer
                    self._playerForDeinit = newPlayer
                    self.setupTimeObserver()
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
                        guard let self else { observer?.invalidate(); return }
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
                print("Failed to load stream: \(error)")
                self.errorMessage = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    private func resolveStreamURL() async throws -> URL {
        if let localPath = localPlaylistPath {
            let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
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
            let mode = AdBlockMode(rawValue: UserDefaults.standard.string(forKey: "adBlockMode") ?? AdBlockMode.local.rawValue) ?? .local
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

        // Ad-blocking proxy for remote HLS streams
        let mode = AdBlockMode(rawValue: UserDefaults.standard.string(forKey: "adBlockMode") ?? AdBlockMode.local.rawValue) ?? .local
        if mode == .local, !url.isFileURL {
            let ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
            let fetcher = RemotePlaylistFetcher(
                userAgent: ua,
                extraHeaders: ["Client-Id": TwitchAPIService.shared.clientId]
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
                switch status {
                case .failed:
                    let detail = playerItem.errorLog()?.events.last
                    let msg = "\(playerItem.error?.localizedDescription ?? "?"), \(detail?.errorComment ?? "") (\(detail?.errorStatusCode ?? 0))"
                    print("🎬 AVPlayerItem FAILED: \(msg)")
                    self?.errorMessage = playerItem.error?.localizedDescription
                case .readyToPlay:
                    print("🎬 AVPlayerItem READY — duration: \(playerItem.duration.seconds)s")
                case .unknown: break
                @unknown default: break
                }
            }
            .store(in: &playerItemCancellables)

        for (name, handler) in [
            (Notification.Name.AVPlayerItemFailedToPlayToEndTime, { (n: Notification) in
                let err = n.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
                print("🎬 FailedToPlayToEndTime: \(err?.localizedDescription ?? "?")")
            }),
            (Notification.Name.AVPlayerItemNewErrorLogEntry, { n in
                if let e = playerItem.errorLog()?.events.last {
                    print("🎬 ErrorLog: \(e.errorComment ?? "") (\(e.errorStatusCode)) — \(e.uri ?? "")")
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

        Task {
            do {
                let url = try await TwitchHLSManager.shared.fetchPlaylistURL(
                    videoID: videoID,
                    isLive: isLive,
                    quality: newQuality
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
                print("Failed to change quality: \(error)")
                self.errorMessage = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    func resetQualityMenuTimer() {
        qualityMenuTask?.cancel()
        if showQualityMenu {
            qualityMenuTask = Task {
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
