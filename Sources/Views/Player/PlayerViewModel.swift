import Foundation
import AVFoundation
import Combine

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

    // Chat Services
    var liveChatService: TwitchChatService?
    var vodChatService: VODChatService?

    @Published var chatMessages: [ChatMessage] = []
    private var cancellables = Set<AnyCancellable>()
    private var playerItemCancellables = Set<AnyCancellable>()
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

    // MARK: - Stream Loading

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
                    self.player?.seek(to: time) { _ in
                        self.player?.play()
                    }
                } else {
                    self.player?.play()
                }
                self.isLoading = false
            } catch {
                print("Failed to load stream: \(error)")
                self.errorMessage = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    /// Résout l'URL du flux selon le contexte (local, clip, live/VOD distant)
    private func resolveStreamURL() async throws -> URL {
        if let localPath = localPlaylistPath {
            let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let localURL = documentsPath.appendingPathComponent(localPath)
            // Support seamlessly upgrading to the new MP4 remux format even if the
            // local path in DB still points to index.m3u8.
            let fallbackMP4URL = documentsPath.appendingPathComponent(localPath).deletingLastPathComponent().appendingPathComponent("video.mp4")
            
            if FileManager.default.fileExists(atPath: fallbackMP4URL.path) {
                print("🎬 [PlayerViewModel] Found remuxed MP4 instead of m3u8, using MP4.")
                return fallbackMP4URL
            }
            
            // AVPlayer cannot natively open local .ts files. If it's a TS remux, it will have an index.m3u8 wrapper.
            let fallbackM3U8URL = documentsPath.appendingPathComponent(localPath).deletingLastPathComponent().appendingPathComponent("index.m3u8")
            
            if FileManager.default.fileExists(atPath: fallbackM3U8URL.path) {
                print("🎬 [PlayerViewModel] Found index.m3u8 (likely wrapping TS), using M3U8.")
                return fallbackM3U8URL
            }
            
            let exists = FileManager.default.fileExists(atPath: localURL.path)
            if !exists {
                throw URLError(.fileDoesNotExist)
            }
            return localURL
        } else if let clipThumb = clipThumbnailURL {
            var urlString = clipThumb.absoluteString
            if let range = urlString.range(of: "-preview-") {
                urlString = String(urlString[..<range.lowerBound]) + ".mp4"
            }
            return URL(string: urlString) ?? clipThumb
        } else {
            return try await TwitchHLSManager.shared.fetchPlaylistURL(
                videoID: videoID,
                isLive: isLive,
                quality: selectedQuality
            )
        }
    }

    /// Crée un AVPlayerItem depuis une URL.
    /// Pour les fichiers locaux (file://), aucun header HTTP n'est appliqué —
    /// AVURLAssetHTTPHeaderFieldsKey n'est valide que pour les URLs HTTP/HTTPS
    /// et peut empêcher le chargement de l'asset local (écran noir).
    private func makePlayerItem(url: URL) -> AVPlayerItem {
        let asset: AVURLAsset
        if url.isFileURL {
            asset = AVURLAsset(url: url)
        } else {
            let headers: [String: String] = [
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
            ]
            asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
        }
        return AVPlayerItem(asset: asset)
    }

    /// Configure les observers d'erreurs sur un AVPlayerItem.
    /// Annule les observers du playerItem précédent avant d'en créer de nouveaux.
    private func setupPlayerItemObservers(_ playerItem: AVPlayerItem) {
        playerItemCancellables.removeAll()

        playerItem.publisher(for: \.status)
            .receive(on: RunLoop.main)
            .sink { [weak self] status in
                switch status {
                case .failed:
                    let err = playerItem.error?.localizedDescription ?? "Unknown failure"
                    var extendedLog = ""
                    if let errorLog = playerItem.errorLog(), let event = errorLog.events.last {
                        extendedLog = " - \(event.errorComment ?? "") (\(event.errorStatusCode))"
                    }
                    print("🎬 [PlayerViewModel] AVPlayerItem FAILED: \(err)\(extendedLog)")
                    self?.errorMessage = err
                case .readyToPlay:
                    print("🎬 [PlayerViewModel] AVPlayerItem READY TO PLAY. Duration: \(playerItem.duration.seconds)")
                case .unknown:
                    print("🎬 [PlayerViewModel] AVPlayerItem status UNKNOWN (loading...)")
                @unknown default:
                    break
                }
            }
            .store(in: &playerItemCancellables)

        NotificationCenter.default.publisher(for: .AVPlayerItemFailedToPlayToEndTime, object: playerItem)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                if let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error {
                    print("🎬 [PlayerViewModel] FailedToPlayToEndTime: \(error.localizedDescription)")
                }
                self?.errorMessage = "Failed to play stream"
            }
            .store(in: &playerItemCancellables)
            
        NotificationCenter.default.publisher(for: .AVPlayerItemNewErrorLogEntry, object: playerItem)
            .receive(on: DispatchQueue.main)
            .sink { _ in
                if let errorLog = playerItem.errorLog(), let event = errorLog.events.last {
                    print("🎬 [PlayerViewModel] ErrorLog Entry: \(event.errorComment ?? "No comment") (\(event.errorStatusCode)) - URI: \(event.uri ?? "")")
                }
            }
            .store(in: &playerItemCancellables)
    }

    /// Configure l'observer de temps périodique pour le chat VOD et l'historique.
    /// Doit être appelé une seule fois après la création de l'AVPlayer.
    private func setupTimeObserver() {
        guard !isLive, timeObserver == nil else { return }
        let interval = CMTime(seconds: 5, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
        timeObserver = player?.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            let seconds = time.seconds
            if seconds > 0 {
                self?.vodChatService?.fetchChat(at: seconds)
                if let duration = self?.player?.currentItem?.duration.seconds, duration.isFinite {
                    self?.onTimeUpdate?(Int(seconds), Int(duration))
                }
            }
        }
    }

    // MARK: - Quality

    /// Change la qualité sans recréer l'AVPlayer.
    /// Seul l'AVPlayerItem est remplacé, évitant tout scintillement ou duplication de flux.
    func changeQuality(to newQuality: String) {
        guard newQuality != selectedQuality else { return }
        guard localPlaylistPath == nil, clipThumbnailURL == nil else { return }

        // Sauvegarder la position courante pour les VOD
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
                    self.player?.seek(to: time) { _ in
                        self.player?.play()
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

    // MARK: - Quality Menu

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
}
