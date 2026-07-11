import SwiftUI
import AVKit
import SwiftData

struct VideoMetadata {
    let title: String
    let viewerCount: Int? // nil for VODs
    let viewCount: Int? // nil for Lives
    let streamerName: String
    let streamerProfileURL: URL?
    let gameName: String?
    let previewThumbnailURL: URL?
}

struct PlayerView: View {
    @StateObject private var viewModel: PlayerViewModel
    let metadata: VideoMetadata?
    
    @Environment(\.modelContext) private var modelContext
    
    init(videoID: String, isLive: Bool, clipThumbnailURL: URL? = nil, metadata: VideoMetadata? = nil) {
        _viewModel = StateObject(wrappedValue: PlayerViewModel(videoID: videoID, isLive: isLive, clipThumbnailURL: clipThumbnailURL))
        self.metadata = metadata
    }
    
    @State private var isFullScreen: Bool = false
    
    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Color.black.ignoresSafeArea()
                
                if let error = viewModel.errorMessage {
                    VStack(spacing: 16) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.largeTitle)
                            .foregroundColor(.red)
                        Text(error)
                            .foregroundColor(.white)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                        
                        Button(action: {
                            viewModel.initialTimecode = 0
                            updateHistory(timecode: 0, duration: 0)
                            viewModel.loadStream()
                        }) {
                            HStack {
                                Image(systemName: "arrow.clockwise")
                                Text("Recharger au début")
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 10)
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(8)
                        }
                    }
                } else if let player = viewModel.player {
                    CustomVideoPlayer(player: player)
                        .onAppear {
                            player.play()
                        }
                        .onDisappear {
                            if !isFullScreen {
                                player.pause()
                            }
                        }
                } else {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        .scaleEffect(2.0)
                }
            }
            // Aspect ratio pour la vidéo (généralement 16:9)
            .aspectRatio(16/9, contentMode: .fit)
            
            // Metadata Section
            if let meta = metadata {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(meta.title)
                            .font(.title3)
                            .bold()
                            .lineLimit(2)
                        
                        HStack(spacing: 12) {
                            if let url = meta.streamerProfileURL {
                                AsyncImage(url: url) { image in
                                    image.resizable().aspectRatio(contentMode: .fill)
                                } placeholder: {
                                    Circle().fill(Color.gray)
                                }
                                .frame(width: 50, height: 50)
                                .clipShape(Circle())
                            }
                            
                            VStack(alignment: .leading, spacing: 4) {
                                Text(meta.streamerName)
                                    .font(.headline)
                                
                                if let game = meta.gameName {
                                    Text(game)
                                        .font(.subheadline)
                                        .foregroundColor(.purple)
                                }
                            }
                            
                            Spacer()
                            
                            VStack(alignment: .trailing, spacing: 4) {
                                if let viewers = meta.viewerCount {
                                    HStack(spacing: 4) {
                                        Circle().fill(Color.red).frame(width: 8, height: 8)
                                        Text("\(viewers) viewers")
                                            .font(.subheadline)
                                            .foregroundColor(.red)
                                    }
                                } else if let views = meta.viewCount {
                                    Text("\(views) views")
                                        .font(.subheadline)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                        
                        Divider()
                        
                        ChatView(messages: viewModel.chatMessages)
                    }
                    .padding()
                }
            } else {
                Spacer()
            }
        }
        .background(Color(.systemBackground))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            let vid = viewModel.videoID
            let descriptor = FetchDescriptor<PersistentHistoryEntry>(predicate: #Predicate { $0.vodId == vid })
            if let existing = try? modelContext.fetch(descriptor).first {
                viewModel.initialTimecode = existing.timecode
            }
            
            viewModel.onTimeUpdate = { timecode, duration in
                updateHistory(timecode: timecode, duration: duration)
            }
            
            viewModel.loadStream()
        }
        .fullScreenCover(isPresented: $isFullScreen) {
            ZStack {
                Color.black.ignoresSafeArea()
                if let player = viewModel.player {
                    CustomVideoPlayer(player: player)
                        .ignoresSafeArea()
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
                if UIDevice.current.orientation.isPortrait {
                    isFullScreen = false
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
            if UIDevice.current.orientation.isLandscape {
                isFullScreen = true
            }
        }
    }
    
    private func updateHistory(timecode: Int, duration: Int) {
        let vid = viewModel.videoID
        let descriptor = FetchDescriptor<PersistentHistoryEntry>(predicate: #Predicate { $0.vodId == vid })
        if let existing = try? modelContext.fetch(descriptor).first {
            existing.timecode = timecode
            existing.duration = duration
            existing.updatedAt = Date()
            
            if let meta = metadata {
                existing.title = meta.title
                existing.streamerName = meta.streamerName
                existing.streamerProfileURL = meta.streamerProfileURL
                existing.gameName = meta.gameName
                existing.viewCount = meta.viewCount
                if let thumb = meta.previewThumbnailURL {
                    existing.previewThumbnailURL = thumb
                }
            }
        } else {
            let entry = PersistentHistoryEntry(
                vodId: vid,
                timecode: timecode,
                duration: duration,
                updatedAt: Date(),
                title: metadata?.title,
                streamerName: metadata?.streamerName,
                streamerProfileURL: metadata?.streamerProfileURL,
                gameName: metadata?.gameName,
                viewCount: metadata?.viewCount,
                previewThumbnailURL: metadata?.previewThumbnailURL
            )
            modelContext.insert(entry)
        }
        try? modelContext.save()
    }
}

struct CustomVideoPlayer: UIViewControllerRepresentable {
    let player: AVPlayer
    
    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.allowsPictureInPicturePlayback = true
        return controller
    }
    
    func updateUIViewController(_ uiViewController: AVPlayerViewController, context: Context) {
        uiViewController.player = player
    }
}
