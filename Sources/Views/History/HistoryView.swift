import SwiftUI
import SwiftData

struct HistoryView: View {
    @Query(sort: \PersistentHistoryEntry.updatedAt, order: .reverse) private var historyEntries: [PersistentHistoryEntry]
    @Environment(\.modelContext) private var modelContext
    
    var body: some View {
        NavigationStack {
            Group {
                if historyEntries.isEmpty {
                    VStack {
                        Text("History is empty")
                            .foregroundColor(.secondary)
                    }
                } else {
                    List {
                            ForEach(historyEntries, id: \.vodId) { entry in
                                NavigationLink(destination: PlayerView(
                                    videoID: entry.vodId,
                                    isLive: false,
                                    metadata: VideoMetadata(
                                        title: entry.title ?? "Unknown VOD",
                                        viewerCount: nil,
                                        viewCount: entry.viewCount,
                                        streamerName: entry.streamerName ?? "Unknown Streamer",
                                        streamerProfileURL: entry.streamerProfileURL,
                                        gameName: entry.gameName,
                                        previewThumbnailURL: entry.previewThumbnailURL
                                    )
                                )) {
                                    HStack {
                                        CachedAsyncImage(url: entry.previewThumbnailURL) { phase in
                                            if let image = phase.image {
                                                image.resizable().aspectRatio(contentMode: .fill)
                                            } else if phase.error != nil {
                                                Color.gray.opacity(0.3)
                                                    .overlay(Image(systemName: "photo").foregroundColor(.gray))
                                            } else {
                                                Color.gray.opacity(0.3)
                                            }
                                        }
                                        .frame(width: 160, height: 90)
                                        .cornerRadius(8)
                                        
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(entry.title ?? "Unknown VOD")
                                                .font(.headline)
                                                .lineLimit(2)
                                                .multilineTextAlignment(.leading)
                                            Text(entry.streamerName ?? "Unknown Streamer")
                                                .font(.subheadline)
                                                .foregroundColor(.secondary)
                                            
                                            ProgressView(value: Double(entry.timecode), total: Double(max(entry.duration, 1)))
                                                .progressViewStyle(LinearProgressViewStyle(tint: .accentColor))
                                                .frame(height: 4)
                                        }
                                        Spacer()
                                    }
                                    .padding(.horizontal)
                                }
                                .buttonStyle(PlainButtonStyle())
                                .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color.clear)
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                    Button(role: .destructive) {
                                        deleteEntry(entry)
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                                .contextMenu {
                                    Button(role: .destructive) {
                                        deleteEntry(entry)
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("History")
        }
    }
    
    private func deleteEntry(_ entry: PersistentHistoryEntry) {
        modelContext.delete(entry)
        try? modelContext.save()
    }
}

struct VODProgressView: View {
    let vodId: String
    @Query private var historyEntries: [PersistentHistoryEntry]
    
    init(vodId: String) {
        self.vodId = vodId
        _historyEntries = Query(filter: #Predicate<PersistentHistoryEntry> { $0.vodId == vodId })
    }
    
    var body: some View {
        if let entry = historyEntries.first {
            ProgressView(value: Double(entry.timecode), total: Double(max(entry.duration, 1)))
                .progressViewStyle(LinearProgressViewStyle(tint: .accentColor))
                .frame(height: 4)
        }
    }
}
