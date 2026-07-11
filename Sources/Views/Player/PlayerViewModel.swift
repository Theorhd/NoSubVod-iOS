import Foundation
import AVFoundation
import Combine

final class PlayerViewModel: ObservableObject, @unchecked Sendable {
    let videoID: String
    let isLive: Bool
    let clipThumbnailURL: URL?
    
    @Published var player: AVPlayer?
    @Published var isLoading: Bool = true
    @Published var errorMessage: String?
    
    // Chat Services
    var liveChatService: TwitchChatService?
    var vodChatService: VODChatService?
    
    @Published var chatMessages: [ChatMessage] = []
    private var cancellables = Set<AnyCancellable>()
    private var timeObserver: Any?
    
    var onTimeUpdate: ((Int, Int) -> Void)?
    var initialTimecode: Int = 0
    
    init(videoID: String, isLive: Bool, clipThumbnailURL: URL? = nil) {
        self.videoID = videoID
        self.isLive = isLive
        self.clipThumbnailURL = clipThumbnailURL
        
        if isLive {
            let service = TwitchChatService()
            service.connect(channel: videoID) // For live, videoID is usually the channel login
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
        if let observer = timeObserver {
            player?.removeTimeObserver(observer)
        }
        liveChatService?.disconnect()
    }
    
    func loadStream() {
        isLoading = true
        errorMessage = nil
        
        Task {
            do {
                let url: URL
                if let clipThumb = clipThumbnailURL {
                    // Extract MP4 URL from clip thumbnail
                    var urlString = clipThumb.absoluteString
                    if let range = urlString.range(of: "-preview-") {
                        urlString = String(urlString[..<range.lowerBound]) + ".mp4"
                    }
                    url = URL(string: urlString) ?? clipThumb
                } else {
                    url = try await TwitchHLSManager.shared.fetchPlaylistURL(videoID: videoID, isLive: isLive)
                }
                
                await MainActor.run {
                    print("AVPlayer URL: \(url.absoluteString)")
                    
                    let headers: [String: String] = [
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
                    ]
                    
                    let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
                    let playerItem = AVPlayerItem(asset: asset)
                    self.player = AVPlayer(playerItem: playerItem)
                    
                    if self.initialTimecode > 0 {
                        let time = CMTime(seconds: Double(self.initialTimecode), preferredTimescale: 1)
                        self.player?.seek(to: time)
                    }
                    
                    self.isLoading = false
                    
                    // Observe errors via publisher for status
                    playerItem.publisher(for: \.status)
                        .receive(on: RunLoop.main)
                        .sink { [weak self] status in
                            if status == .failed {
                                self?.errorMessage = playerItem.error?.localizedDescription ?? "Failed to play stream"
                            }
                        }
                        .store(in: &self.cancellables)
                    
                    // Observe errors
                    NotificationCenter.default.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: playerItem, queue: .main) { [weak self] _ in
                        self?.errorMessage = "Failed to play stream"
                    }
                    
                    // Setup time observer for VOD chat and history
                    if !self.isLive {
                        let interval = CMTime(seconds: 5, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
                        self.timeObserver = self.player?.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
                            let seconds = time.seconds
                            if seconds > 0 {
                                self?.vodChatService?.fetchChat(at: seconds)
                                if let duration = self?.player?.currentItem?.duration.seconds, duration.isFinite {
                                    self?.onTimeUpdate?(Int(seconds), Int(duration))
                                }
                            }
                        }
                    }
                }
            } catch {
                print("Failed to load stream: \(error)")
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    self.isLoading = false
                }
            }
        }
    }
}
