import SwiftUI
import SwiftData

struct DownloadsView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @Query(sort: \VODDownload.addedAt, order: .reverse) private var downloads: [VODDownload]
    @StateObject private var downloadManager = VODDownloadManager.shared
    
    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 16) {
                    if downloads.isEmpty {
                        VStack(spacing: 12) {
                            Image(systemName: "tray")
                                .font(.system(size: 48))
                                .foregroundColor(.secondary)
                            Text("No downloads yet")
                                .font(.headline)
                                .foregroundColor(.secondary)
                        }
                        .padding(.top, 100)
                    } else {
                        ForEach(downloads) { download in
                            DownloadCard(download: download, downloadManager: downloadManager)
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Downloads")
            .background(Color(.systemGroupedBackground).ignoresSafeArea())
        }
        // Keep screen awake while downloads are in progress
        .onAppear {
            let hasActiveDownloads = downloads.contains { $0.state == .downloading }
            if hasActiveDownloads {
                UIApplication.shared.isIdleTimerDisabled = true
            }
        }
        .onDisappear {
            // Only re-enable idle timer if no downloads are currently in progress
            let hasActive = downloadManager.activeDownloads.values.contains { $0 > 0 && $0 < 1.0 }
            if !hasActive {
                UIApplication.shared.isIdleTimerDisabled = false
            }
        }
        // Auto-resume downloads when app returns to foreground
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                downloadManager.resumeActiveDownloads(modelContext: modelContext)
            }
        }
    }
}

struct DownloadCard: View {
    let download: VODDownload
    @ObservedObject var downloadManager: VODDownloadManager
    @Environment(\.modelContext) private var modelContext
    
    @State private var showMissingFileAlert = false

    var body: some View {
        if download.state == .completed {
            if let path = download.localPlaylistPath {
                NavigationLink(
                    destination: PlayerView(
                        videoID: download.vodId,
                        isLive: false,
                        metadata: VideoMetadata(
                            title: download.title,
                            viewerCount: nil,
                            viewCount: download.viewCount,
                            streamerName: download.streamerName ?? "Unknown",
                            streamerProfileURL: download.streamerProfileURL,
                            gameName: download.gameName,
                            previewThumbnailURL: download.thumbnailURL
                        ),
                        localPlaylistPath: path
                    )
                ) {
                    cardContent(progress: 1.0)
                }
                .buttonStyle(PlainButtonStyle())
                .contextMenu {
                    Button(role: .destructive, action: {
                        downloadManager.deleteDownload(vodId: download.vodId, modelContext: modelContext)
                    }) {
                        Label("Delete", systemImage: "trash")
                    }
                }
            } else {
                // localPlaylistPath is unexpectedly nil — show the card but block navigation.
                Button {
                    showMissingFileAlert = true
                } label: {
                    cardContent(progress: 1.0)
                }
                .buttonStyle(PlainButtonStyle())
                .alert("File unavailable", isPresented: $showMissingFileAlert) {
                    Button("Delete", role: .destructive) {
                        downloadManager.deleteDownload(vodId: download.vodId, modelContext: modelContext)
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("The local playlist file for this VOD is missing. You can delete it and re-download.")
                }
                .contextMenu {
                    Button(role: .destructive, action: {
                        downloadManager.deleteDownload(vodId: download.vodId, modelContext: modelContext)
                    }) {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        } else {
            cardContent(progress: currentProgress)
                .contextMenu {
                    Button(role: .destructive, action: {
                        downloadManager.deleteDownload(vodId: download.vodId, modelContext: modelContext)
                    }) {
                        Label("Delete", systemImage: "trash")
                    }
                }
        }
    }
    
    private var currentProgress: Double {
        if download.state == .completed { return 1.0 }
        if let liveProgress = downloadManager.activeDownloads[download.vodId] {
            return liveProgress
        }
        return download.progress
    }
    
    @ViewBuilder
    private func cardContent(progress: Double) -> some View {
        ZStack(alignment: .leading) {
            // Base background
            Color.black
            
            // Progress background
            GeometryReader { geo in
                Color.gray.opacity(0.4)
                    .frame(width: geo.size.width * progress)
                    .animation(.linear(duration: 0.5), value: progress)
            }
            
            HStack(spacing: 12) {
                // Thumbnail
                if let url = download.thumbnailURL {
                    CachedAsyncImage(url: url) { image in
                        image.resizable()
                            .aspectRatio(contentMode: .fill)
                    } placeholder: {
                        Color.gray
                    }
                    .frame(width: 120, height: 68)
                    .cornerRadius(8)
                    .clipped()
                } else {
                    Color.gray
                        .frame(width: 120, height: 68)
                        .cornerRadius(8)
                }
                
                VStack(alignment: .leading, spacing: 4) {
                    Text(download.title)
                        .font(.headline)
                        .foregroundColor(.white)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    
                    if download.isSegment {
                        Text("Segment")
                            .font(.caption)
                            .foregroundColor(.purple)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.purple.opacity(0.2))
                            .cornerRadius(4)
                    }
                    
                    Spacer()
                    
                    VODProgressView(vodId: download.vodId)
                    
                    HStack(spacing: 4) {
                        if download.state == .downloading {
                            Text("\(Int(progress * 100))%")
                                .font(.caption)
                                .foregroundColor(.gray)
                            if let speed = downloadManager.downloadSpeeds[download.vodId], speed > 0 {
                                Text("•")
                                    .font(.caption)
                                    .foregroundColor(.gray)
                                Text(speedFormatted(speed))
                                    .font(.caption)
                                    .foregroundColor(.gray)
                            }
                        } else if download.state == .completed {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Downloaded")
                                .font(.caption)
                                .foregroundColor(.gray)
                            if let duration = download.durationSeconds {
                                Text("•")
                                    .font(.caption)
                                    .foregroundColor(.gray)
                                Text(formatDuration(duration))
                                    .font(.caption)
                                    .foregroundColor(.gray)
                            }
                            if let size = folderSize(for: download.vodId) {
                                Text("•")
                                    .font(.caption)
                                    .foregroundColor(.gray)
                                Text(formatDiskSize(size))
                                    .font(.caption)
                                    .foregroundColor(.gray)
                            }
                        } else if download.state == .failed {
                            Image(systemName: "exclamationmark.circle.fill")
                                .foregroundColor(.red)
                            Text("Failed")
                                .font(.caption)
                                .foregroundColor(.red)
                        }
                    }
                }
                .padding(.vertical, 4)
                
                Spacer()
            }
            .padding(8)
        }
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.white.opacity(0.1), lineWidth: 1)
        )
    }

    // MARK: - Helpers

    private func speedFormatted(_ mbPerSec: Double) -> String {
        String(format: "%.1f MB/s", mbPerSec)
    }

    private func formatDuration(_ seconds: Double) -> String {
        let total = Int(seconds)
        let h = total / 3600
        let m = (total % 3600) / 60
        if h > 0 { return "\(h)h \(m)m" }
        return "\(m) min"
    }

    private func formatDiskSize(_ bytes: UInt64) -> String {
        let mb = Double(bytes) / 1_048_576.0
        if mb >= 1000 { return String(format: "%.1f GB", mb / 1024.0) }
        return String(format: "%.0f MB", mb)
    }

    private func folderSize(for vodId: String) -> UInt64? {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let vodDirectory = documentsPath
            .appendingPathComponent("downloads")
            .appendingPathComponent(vodId)
        guard let enumerator = FileManager.default.enumerator(
            at: vodDirectory,
            includingPropertiesForKeys: [.fileSizeKey]
        ) else { return nil }
        var total: UInt64 = 0
        for case let fileURL as URL in enumerator {
            guard let values = try? fileURL.resourceValues(forKeys: [.fileSizeKey]),
                  let size = values.fileSize else { continue }
            total += UInt64(size)
        }
        return total > 0 ? total : nil
    }
}
