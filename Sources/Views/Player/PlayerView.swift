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
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("defaultVideoQuality") private var defaultVideoQuality = "auto"
    
    @State private var historyActor: HistoryManagerActor?
    
    init(videoID: String, isLive: Bool, clipThumbnailURL: URL? = nil, metadata: VideoMetadata? = nil, localPlaylistPath: String? = nil) {
        _viewModel = StateObject(wrappedValue: PlayerViewModel(videoID: videoID, isLive: isLive, clipThumbnailURL: clipThumbnailURL, localPlaylistPath: localPlaylistPath))
        self.metadata = metadata
    }
    
    @State private var isFullScreen: Bool = false
    @State private var isDownloadSheetPresented = false
    @State private var isSegmentSelectionMode = false
    @State private var startTimecode: Int?
    @State private var endTimecode: Int?
    @State private var showSegmentSuccess = false
    @State private var selectedSegmentQuality: String = "chunked"
    
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
                        .overlay(alignment: .topTrailing) {
                            if viewModel.localPlaylistPath == nil {
                                qualityMenu
                                    .opacity(viewModel.showQualityMenu ? 1 : 0)
                                    .animation(.easeInOut(duration: 0.3), value: viewModel.showQualityMenu)
                            }
                        }
                        .simultaneousGesture(TapGesture().onEnded {
                            viewModel.toggleQualityMenu()
                        })
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
            
            if isSegmentSelectionMode, let player = viewModel.player {
                VStack(spacing: 8) {
                    HStack {
                        Text("Sélectionnez le segment à télécharger")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    
                    HStack(spacing: 12) {
                        Button(action: {
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                                startTimecode = Int(player.currentTime().seconds)
                                checkSegmentSelection()
                            }
                        }) {
                            VStack(spacing: 4) {
                                Image(systemName: startTimecode == nil ? "play.circle" : "checkmark.circle.fill")
                                    .font(.title3)
                                Text(startTimecode == nil ? "Début" : formatTime(startTimecode!))
                                    .font(.footnote)
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(startTimecode == nil ? Color(.systemGray6) : Color.purple)
                            .foregroundColor(startTimecode == nil ? .primary : .white)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        
                        Button(action: {
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                                endTimecode = Int(player.currentTime().seconds)
                                checkSegmentSelection()
                            }
                        }) {
                            VStack(spacing: 4) {
                                Image(systemName: endTimecode == nil ? "stop.circle" : "checkmark.circle.fill")
                                    .font(.title3)
                                Text(endTimecode == nil ? "Fin" : formatTime(endTimecode!))
                                    .font(.footnote)
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(endTimecode == nil ? Color(.systemGray6) : Color.purple)
                            .foregroundColor(endTimecode == nil ? .primary : .white)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.vertical, 12)
                .background(Color(.systemBackground))
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            
            // Metadata Section
            if let meta = metadata {
                VStack(alignment: .leading, spacing: 12) {
                    Text(meta.title)
                        .font(.title3)
                        .bold()
                        .lineLimit(2)
                    
                    HStack(spacing: 12) {
                        if let url = meta.streamerProfileURL {
                            CachedAsyncImage(url: url) { image in
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
                            
                            if !viewModel.isLive && viewModel.localPlaylistPath == nil {
                                Button(action: {
                                    isDownloadSheetPresented = true
                                }) {
                                    Image(systemName: "arrow.down.circle")
                                        .foregroundColor(.purple)
                                        .font(.title2)
                                }
                                .padding(.top, 4)
                            }
                        }
                    }
                    
                    Divider()
                    
                    ChatView(messages: viewModel.chatMessages)
                }
                .padding()
            } else {
                Spacer()
            }
        }
        .background(Color(.systemBackground))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if historyActor == nil {
                historyActor = HistoryManagerActor(modelContainer: modelContext.container)
            }
            
            let vid = viewModel.videoID
            let descriptor = FetchDescriptor<PersistentHistoryEntry>(predicate: #Predicate { $0.vodId == vid })
            if let existing = try? modelContext.fetch(descriptor).first {
                viewModel.initialTimecode = existing.timecode
            }
            
            viewModel.onTimeUpdate = { timecode, duration in
                updateHistory(timecode: timecode, duration: duration)
            }
            
            if viewModel.selectedQuality == "auto" && defaultVideoQuality != "auto" {
                viewModel.selectedQuality = defaultVideoQuality
            }
            
            viewModel.loadStream()
            viewModel.resetQualityMenuTimer()
        }
        .fullScreenCover(isPresented: $isFullScreen) {
            ZStack {
                Color.black.ignoresSafeArea()
                if let player = viewModel.player {
                    CustomVideoPlayer(player: player)
                        .ignoresSafeArea()
                        .overlay(alignment: .topTrailing) {
                            if viewModel.localPlaylistPath == nil {
                                qualityMenu
                                    .padding(.top, 40) // safe area padding
                                    .opacity(viewModel.showQualityMenu ? 1 : 0)
                                    .animation(.easeInOut(duration: 0.3), value: viewModel.showQualityMenu)
                            }
                        }
                        .simultaneousGesture(TapGesture().onEnded {
                            viewModel.toggleQualityMenu()
                        })
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
        .onChange(of: scenePhase) { oldPhase, newPhase in
            if newPhase == .background || newPhase == .inactive {
                if let player = viewModel.player, !viewModel.isLive {
                    let currentTime = Int(player.currentTime().seconds)
                    if let duration = player.currentItem?.duration.seconds, duration.isFinite {
                        updateHistory(timecode: currentTime, duration: Int(duration))
                    }
                }
            }
        }
        .onDisappear {
            if let player = viewModel.player, !viewModel.isLive {
                let currentTime = Int(player.currentTime().seconds)
                if let duration = player.currentItem?.duration.seconds, duration.isFinite {
                    updateHistory(timecode: currentTime, duration: Int(duration))
                }
            }
        }
        .sheet(isPresented: $isDownloadSheetPresented) {
            DownloadBottomSheet(
                isPresented: $isDownloadSheetPresented,
                isSegmentSelectionMode: $isSegmentSelectionMode,
                onDownloadFull: { quality in
                    VODDownloadManager.shared.startDownload(
                        vodId: viewModel.videoID,
                        title: metadata?.title ?? "VOD",
                        thumbnailURL: metadata?.previewThumbnailURL,
                        isSegment: false,
                        startTime: nil,
                        endTime: nil,
                        quality: quality,
                        streamerName: metadata?.streamerName,
                        streamerProfileURL: metadata?.streamerProfileURL,
                        gameName: metadata?.gameName,
                        viewCount: metadata?.viewCount,
                        modelContext: modelContext
                    )
                },
                onDownloadSegment: { quality in
                    selectedSegmentQuality = quality
                    isSegmentSelectionMode = true
                    startTimecode = nil
                    endTimecode = nil
                },
                isSuccessMode: showSegmentSuccess
            )
        }
    }
    
    private var qualityMenu: some View {
        Menu {
            Picker("Quality", selection: Binding(
                get: { viewModel.selectedQuality },
                set: { newValue in
                    viewModel.changeQuality(to: newValue)
                }
            )) {
                Text("Auto").tag("auto")
                Text("1080p").tag("1080p")
                Text("720p").tag("720p")
                Text("480p").tag("480p")
                Text("360p").tag("360p")
                Text("160p").tag("160p")
                Text("Audio Only").tag("Audio Only")
            }
        } label: {
            Image(systemName: "gearshape.fill")
                .font(.system(size: 20))
                .foregroundColor(.white)
                .padding(8)
                .background(Color.black.opacity(0.5))
                .clipShape(Circle())
        }
        .padding()
    }
    
    private func checkSegmentSelection() {
        if startTimecode != nil && endTimecode != nil {
            isSegmentSelectionMode = false
            showSegmentSuccess = true
            isDownloadSheetPresented = true
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                isDownloadSheetPresented = false
                showSegmentSuccess = false
                
                if let start = startTimecode, let end = endTimecode {
                    let minTime = min(start, end)
                    let maxTime = max(start, end)
                    VODDownloadManager.shared.startDownload(
                        vodId: viewModel.videoID,
                        title: metadata?.title ?? "VOD Segment",
                        thumbnailURL: metadata?.previewThumbnailURL,
                        isSegment: true,
                        startTime: minTime,
                        endTime: maxTime,
                        quality: selectedSegmentQuality,
                        streamerName: metadata?.streamerName,
                        streamerProfileURL: metadata?.streamerProfileURL,
                        gameName: metadata?.gameName,
                        viewCount: metadata?.viewCount,
                        modelContext: modelContext
                    )
                }
            }
        }
    }
    
    private func formatTime(_ seconds: Int) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        } else {
            return String(format: "%02d:%02d", m, s)
        }
    }
    
    private func updateHistory(timecode: Int, duration: Int) {
        guard let actor = historyActor else { return }
        let vid = viewModel.videoID
        let meta = metadata
        
        Task {
            await actor.updateHistory(
                vodId: vid,
                timecode: timecode,
                duration: duration,
                title: meta?.title,
                streamerName: meta?.streamerName,
                streamerProfileURL: meta?.streamerProfileURL,
                gameName: meta?.gameName,
                viewCount: meta?.viewCount,
                previewThumbnailURL: meta?.previewThumbnailURL
            )
        }
    }
}

