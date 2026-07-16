import SwiftUI

struct SearchView: View {
    @StateObject private var viewModel = SearchViewModel()
    @State private var searchText = ""
    
    var body: some View {
        NavigationStack {
            VStack {
                if searchText.isEmpty {
                    ContentUnavailableView("Search", systemImage: "magnifyingglass", description: Text("Search for channels or VODs"))
                } else if viewModel.isSearching {
                    ProgressView()
                } else if let results = viewModel.searchResults {
                    if results.categories.isEmpty && results.liveStreams.isEmpty && results.channels.isEmpty {
                        ContentUnavailableView("No results", systemImage: "magnifyingglass", description: Text("Try searching for something else"))
                    } else {
                        List {
                            if !results.categories.isEmpty {
                                Section("Categories") {
                                    ForEach(results.categories, id: \.id) { game in
                                        NavigationLink(destination: CategoryView(game: game)) {
                                            HStack(spacing: 12) {
                                                CachedAsyncImage(url: game.boxArtURL) { image in
                                                    image.resizable().aspectRatio(contentMode: .fit)
                                                } placeholder: {
                                                    Color.gray
                                                }
                                                .frame(width: 40, height: 56)
                                                .cornerRadius(4)
                                                
                                                Text(game.name)
                                                    .font(.headline)
                                            }
                                            .padding(.vertical, 4)
                                        }
                                    }
                                }
                            }
                            
                            if !results.liveStreams.isEmpty {
                                Section("Live Streams") {
                                    ForEach(results.liveStreams) { stream in
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
                                            HStack(spacing: 12) {
                                                CachedAsyncImage(url: stream.previewImageURL) { image in
                                                    image.resizable().aspectRatio(contentMode: .fill)
                                                } placeholder: {
                                                    Color.gray
                                                }
                                                .frame(width: 120, height: 68)
                                                .cornerRadius(8)
                                                
                                                VStack(alignment: .leading, spacing: 4) {
                                                    Text(stream.title)
                                                        .font(.headline)
                                                        .lineLimit(2)
                                                    Text(stream.broadcaster.displayName)
                                                        .font(.subheadline)
                                                        .foregroundColor(.secondary)
                                                    Text("\(stream.viewerCount) viewers")
                                                        .font(.caption)
                                                        .foregroundColor(.red)
                                                }
                                            }
                                            .padding(.vertical, 4)
                                        }
                                    }
                                }
                            }
                            
                            if !results.channels.isEmpty {
                                Section("Channels") {
                                    ForEach(results.channels, id: \.id) { channel in
                                        NavigationLink(destination: ChannelView(login: channel.login)) {
                                            HStack(spacing: 12) {
                                                CachedAsyncImage(url: channel.profileImageURL) { image in
                                                    image.resizable().aspectRatio(contentMode: .fill)
                                                } placeholder: {
                                                    Color.gray
                                                }
                                                .frame(width: 50, height: 50)
                                                .clipShape(Circle())
                                                
                                                Text(channel.displayName)
                                                    .font(.headline)
                                            }
                                            .padding(.vertical, 4)
                                        }
                                    }
                                }
                            }
                        }
                        .listStyle(.grouped)
                    }
                }
            }
            .navigationTitle("Search")
        }
        .searchable(text: $searchText, prompt: "Channels, games, etc.")
        .task(id: searchText) {
            viewModel.performSearch(query: searchText)
        }
    }
}
