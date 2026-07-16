import SwiftUI

struct CategoryView: View {
    let game: Game
    @StateObject private var viewModel: CategoryViewModel
    
    init(game: Game) {
        self.game = game
        _viewModel = StateObject(wrappedValue: CategoryViewModel(game: game))
    }
    
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                HStack(spacing: 16) {
                    if let url = game.boxArtURL {
                        CachedAsyncImage(url: url) { image in
                            image.resizable().aspectRatio(contentMode: .fit)
                        } placeholder: {
                            Color.gray.opacity(0.3)
                        }
                        .frame(width: 90, height: 120)
                        .cornerRadius(8)
                    }
                    
                    Text(game.name)
                        .font(.largeTitle)
                        .bold()
                    
                    Spacer()
                }
                .padding(.horizontal)
                
                if viewModel.isLoading {
                    ProgressView()
                        .padding(.top, 40)
                } else {
                    // Lives Section
                    if !viewModel.lives.isEmpty {
                        categorySection(title: "Live Streams", items: viewModel.lives) { stream in
                            NavigationLink(destination: PlayerView(
                                videoID: stream.broadcaster.login,
                                isLive: true,
                                metadata: VideoMetadata(
                                    title: stream.title,
                                    viewerCount: stream.viewerCount,
                                    viewCount: nil,
                                    streamerName: stream.broadcaster.displayName,
                                    streamerProfileURL: stream.broadcaster.profileImageURL,
                                    gameName: stream.game?.name,
                                    previewThumbnailURL: stream.previewImageURL
                                )
                            )) {
                                LiveCard(stream: stream)
                            }
                            .buttonStyle(PlainButtonStyle())
                        }
                    }
                    
                    // VODs Section
                    if !viewModel.vods.isEmpty {
                        categorySection(title: "Recent VODs", items: viewModel.vods) { vod in
                            NavigationLink(destination: PlayerView(
                                videoID: vod.id,
                                isLive: false,
                                metadata: VideoMetadata(
                                    title: vod.title,
                                    viewerCount: nil,
                                    viewCount: vod.viewCount,
                                    streamerName: vod.owner?.displayName ?? "",
                                    streamerProfileURL: vod.owner?.profileImageURL,
                                    gameName: vod.game?.name,
                                    previewThumbnailURL: vod.previewThumbnailURL
                                )
                            )) {
                                VODCard(vod: vod)
                            }
                            .buttonStyle(PlainButtonStyle())
                        }
                    }
                    
                    // Clips Section
                    if !viewModel.clips.isEmpty {
                        categorySection(title: "Popular Clips", items: viewModel.clips) { clip in
                            NavigationLink(destination: PlayerView(
                                videoID: clip.id,
                                isLive: false,
                                clipThumbnailURL: clip.previewThumbnailURL,
                                metadata: VideoMetadata(
                                    title: clip.title,
                                    viewerCount: nil,
                                    viewCount: clip.viewCount,
                                    streamerName: clip.owner?.displayName ?? "",
                                    streamerProfileURL: clip.owner?.profileImageURL,
                                    gameName: clip.game?.name,
                                    previewThumbnailURL: clip.previewThumbnailURL
                                )
                            )) {
                                VODCard(vod: clip)
                            }
                            .buttonStyle(PlainButtonStyle())
                        }
                    }
                }
            }
            .padding(.vertical)
        }
        .navigationTitle(game.name)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: game.id) {
            await viewModel.loadData()
        }
    }
    
    private func categorySection<T: Identifiable, Content: View>(
        title: String,
        items: [T],
        @ViewBuilder content: @escaping (T) -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(title)
                    .font(.title2)
                    .bold()
                Spacer()
                Button("See all") {
                    // TODO: Navigation vers CategoryAllView
                }
                .font(.subheadline)
            }
            .padding(.horizontal)
            
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 16) {
                    ForEach(items) { item in
                        content(item)
                    }
                }
                .padding(.horizontal)
            }
        }
    }
}

// Reusable UI Components
struct LiveCard: View {
    let stream: LiveStream
    var body: some View {
        VStack(alignment: .leading) {
            CachedAsyncImage(url: stream.previewImageURL) { phase in
                if let image = phase.image {
                    image.resizable().aspectRatio(contentMode: .fill)
                } else {
                    Color.gray.opacity(0.3)
                }
            }
            .frame(width: 250, height: 140)
            .cornerRadius(12)
            
            Text(stream.broadcaster.displayName)
                .font(.headline)
            Text(stream.title)
                .font(.subheadline)
                .lineLimit(1)
                .foregroundColor(.secondary)
        }
        .frame(width: 250)
    }
}

struct VODCard: View {
    let vod: VOD
    var body: some View {
        VStack(alignment: .leading) {
            CachedAsyncImage(url: vod.previewThumbnailURL) { phase in
                if let image = phase.image {
                    image.resizable().aspectRatio(contentMode: .fill)
                } else {
                    Color.gray.opacity(0.3)
                }
            }
            .frame(width: 160, height: 90)
            .cornerRadius(8)
            
            Text(vod.title)
                .font(.headline)
                .lineLimit(2)
            Text(vod.owner?.displayName ?? "")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .frame(width: 160)
    }
}
