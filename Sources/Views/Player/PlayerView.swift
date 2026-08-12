import SwiftUI
import AVKit
import SwiftData

struct VideoMetadata {
    let title: String
    let viewerCount: Int?
    let viewCount: Int?
    let streamerName: String
    let streamerProfileURL: URL?
    let gameName: String?
    let previewThumbnailURL: URL?
}

struct PlayerView: View {
    @StateObject private var viewModel: PlayerViewModel
    @StateObject private var authManager = TwitchAuthManager.shared
    let metadata: VideoMetadata?

    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("defaultVideoQuality") private var defaultVideoQuality = "auto"
    @AppStorage("defaultVideoQualityCellular") private var defaultVideoQualityCellular = "auto"
    
    @State private var historyActor: HistoryManagerActor?
    @State private var showLoginSheet = false

    init(videoID: String, isLive: Bool, clipThumbnailURL: URL? = nil, metadata: VideoMetadata? = nil, localPlaylistPath: String? = nil) {
        _viewModel = StateObject(wrappedValue: PlayerViewModel(videoID: videoID, isLive: isLive, clipThumbnailURL: clipThumbnailURL, localPlaylistPath: localPlaylistPath))
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
                } else if let controller = viewModel.playerController {
                    CustomVideoPlayer(playerController: controller)
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
                        .onDisappear {
                            // Pause only when the whole PlayerView is dismissed,
                            // not when the inline controller is stolen by the
                            // full-screen cover (re-parenting).
                            if !isFullScreen {
                                viewModel.player?.pause()
                            }
                        }
                } else {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        .scaleEffect(2.0)
                }
            }
            .aspectRatio(16/9, contentMode: .fit)
            
            if viewModel.isSegmentSelectionMode, viewModel.player != nil {
                VStack(spacing: 8) {
                    HStack {
                        Text("Sélectionnez le segment à télécharger")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    
                    HStack(spacing: 12) {
                        Button(action: { viewModel.setStartTimecode() }) {
                            VStack(spacing: 4) {
                                Image(systemName: viewModel.startTimecode == nil ? "play.circle" : "checkmark.circle.fill")
                                    .font(.title3)
                                Text(viewModel.startTimecode.map { formatTime($0) } ?? "Début")
                                    .font(.footnote)
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(viewModel.startTimecode == nil ? Color(.systemGray6) : Color.purple)
                            .foregroundColor(viewModel.startTimecode == nil ? .primary : .white)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }

                        Button(action: { viewModel.setEndTimecode() }) {
                            VStack(spacing: 4) {
                                Image(systemName: viewModel.endTimecode == nil ? "stop.circle" : "checkmark.circle.fill")
                                    .font(.title3)
                                Text(viewModel.endTimecode.map { formatTime($0) } ?? "Fin")
                                    .font(.footnote)
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(viewModel.endTimecode == nil ? Color(.systemGray6) : Color.purple)
                            .foregroundColor(viewModel.endTimecode == nil ? .primary : .white)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.vertical, 12)
                .background(Color(.systemBackground))
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            
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
                                    viewModel.isDownloadSheetPresented = true
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

                    ChatView(
                        messages: viewModel.chatMessages,
                        isLiveChat: viewModel.isLive,
                        canSend: authManager.isAuthenticated,
                        sendError: viewModel.chatSendError,
                        onSend: { viewModel.sendChatMessage($0) },
                        onLogin: { showLoginSheet = true }
                    )
                }
                .padding()
            } else {
                Spacer()
            }
        }
        .background(Color(.systemBackground))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            UIDevice.current.beginGeneratingDeviceOrientationNotifications()

            if historyActor == nil {
                historyActor = HistoryManagerActor(modelContainer: modelContext.container)
            }
            
            let vid = viewModel.videoID
            let descriptor = FetchDescriptor<PersistentHistoryEntry>(predicate: #Predicate { $0.vodId == vid })
            // Valeur optionnelle, nil prévu
            if let existing = try? modelContext.fetch(descriptor).first {
                viewModel.initialTimecode = existing.timecode
            }
            
            viewModel.onTimeUpdate = { timecode, duration in
                updateHistory(timecode: timecode, duration: duration)
            }
            
            let targetQuality = NetworkMonitor.shared.isCellular ? defaultVideoQualityCellular : defaultVideoQuality
            if viewModel.selectedQuality == "auto" && targetQuality != "auto" {
                viewModel.selectedQuality = targetQuality
            }
            
            viewModel.onSegmentDownloadRequested = { [weak viewModel] start, end, quality in
                guard let viewModel else { return }
                VODDownloadManager.shared.startDownload(
                    vodId: viewModel.videoID,
                    title: metadata?.title ?? "VOD Segment",
                    thumbnailURL: metadata?.previewThumbnailURL,
                    isSegment: true,
                    startTime: start,
                    endTime: end,
                    quality: quality,
                    streamerName: metadata?.streamerName,
                    streamerProfileURL: metadata?.streamerProfileURL,
                    gameName: metadata?.gameName,
                    viewCount: metadata?.viewCount,
                    modelContext: modelContext
                )
            }

            viewModel.loadStream()
            viewModel.resetQualityMenuTimer()
        }
        .fullScreenCover(isPresented: $isFullScreen) {
            ZStack {
                Color.black.ignoresSafeArea()
                if let controller = viewModel.playerController {
                    CustomVideoPlayer(playerController: controller)
                        .ignoresSafeArea()
                        .overlay(alignment: .topTrailing) {
                            if viewModel.localPlaylistPath == nil {
                                qualityMenu
                                    .padding(.top, 40)
                                    .opacity(viewModel.showQualityMenu ? 1 : 0)
                                    .animation(.easeInOut(duration: 0.3), value: viewModel.showQualityMenu)
                            }
                        }
                        .simultaneousGesture(TapGesture().onEnded {
                            viewModel.toggleQualityMenu()
                        })
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
            let orientation = UIDevice.current.orientation
            // Ignore face-up, face-down, and unknown — only react to flat-landscape/portrait.
            guard orientation.isValidInterfaceOrientation else { return }

            if orientation.isLandscape {
                // Don't open our cover if UIKit native full-screen is already active
                // (the user pressed the AVPlayerViewController full-screen button).
                guard !viewModel.isNativeFullScreen else { return }
                if !isFullScreen { isFullScreen = true }
            } else if orientation.isPortrait {
                if isFullScreen { isFullScreen = false }
            }
        }
        .onChange(of: isFullScreen) { _, full in
            guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
            let target: UIInterfaceOrientationMask = full ? .landscape : .portrait
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: target))
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
            UIDevice.current.endGeneratingDeviceOrientationNotifications()

            if let player = viewModel.player, !viewModel.isLive {
                let currentTime = Int(player.currentTime().seconds)
                if let duration = player.currentItem?.duration.seconds, duration.isFinite {
                    updateHistory(timecode: currentTime, duration: Int(duration))
                }
            }
        }
        .sheet(isPresented: $showLoginSheet) {
            TwitchLoginSheet {
                // Le chat s'était connecté en anonyme — on rejoint le salon
                // avec le compte fraîchement connecté (PASS oauth + NICK).
                viewModel.reconnectChatIfNeeded()
            }
        }
        .sheet(isPresented: $viewModel.isDownloadSheetPresented) {
            DownloadBottomSheet(
                isPresented: $viewModel.isDownloadSheetPresented,
                isSegmentSelectionMode: $viewModel.isSegmentSelectionMode,
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
                    viewModel.selectedSegmentQuality = quality
                    viewModel.isSegmentSelectionMode = true
                    viewModel.startTimecode = nil
                    viewModel.endTimecode = nil
                },
                isSuccessMode: viewModel.showSegmentSuccess
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

