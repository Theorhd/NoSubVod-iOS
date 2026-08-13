import SwiftUI
import SwiftData

struct SearchView: View {
    @StateObject private var viewModel = SearchViewModel()
    @State private var searchText = ""
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \PersistentRecentSearch.createdAt, order: .reverse) private var recentSearches: [PersistentRecentSearch]

    private static let maxRecentSearches = 8

    var body: some View {
        NavigationStack {
            VStack {
                if searchText.isEmpty {
                    discoveryContent
                } else if viewModel.isSearching {
                    ProgressView()
                } else if let results = viewModel.searchResults {
                    if results.categories.isEmpty && results.liveStreams.isEmpty && results.channels.isEmpty {
                        ContentUnavailableView("No results", systemImage: "magnifyingglass", description: Text("Try searching for something else"))
                    } else {
                        searchResultsList(results)
                    }
                }
            }
            .navigationTitle("Search")
        }
        .searchable(text: $searchText, prompt: "Channels, games, etc.")
        .onSubmit(of: .search) {
            recordSearch(searchText)
        }
        .task(id: searchText) {
            viewModel.performSearch(query: searchText)
        }
    }

    // MARK: - Découverte (champ vide)

    private var discoveryContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if !recentSearches.isEmpty {
                    recentSearchesSection
                }

                Text(NSLocalizedString("Popular Categories", comment: ""))
                    .font(.title2)
                    .bold()
                    .padding(.horizontal)

                if viewModel.isLoadingPopular {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 30)
                } else {
                    popularCategoriesGrid
                }
            }
            .padding(.vertical)
        }
        .task {
            viewModel.loadPopularGames()
        }
    }

    private var recentSearchesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(NSLocalizedString("Recent Search", comment: ""))
                    .font(.title2)
                    .bold()
                Spacer()
                Button {
                    clearRecentSearches()
                } label: {
                    Text(NSLocalizedString("Clear", comment: ""))
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.horizontal)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(recentSearches, id: \.query) { search in
                        Button {
                            searchText = search.query
                        } label: {
                            Text(search.query)
                                .font(.subheadline)
                                .lineLimit(1)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(Color(.secondarySystemBackground))
                                .cornerRadius(16)
                        }
                        .buttonStyle(PlainButtonStyle())
                    }
                }
                .padding(.horizontal)
            }
        }
    }

    private var popularCategoriesGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 16) {
            ForEach(viewModel.popularGames, id: \.id) { game in
                NavigationLink(destination: CategoryView(game: game)) {
                    VStack(alignment: .leading, spacing: 4) {
                        CachedAsyncImage(url: game.boxArtURL) { image in
                            image.resizable().aspectRatio(contentMode: .fill)
                        } placeholder: {
                            Color.gray.opacity(0.3)
                        }
                        .frame(maxWidth: .infinity)
                        .aspectRatio(3 / 4, contentMode: .fit)
                        .cornerRadius(8)

                        Text(game.name)
                            .font(.caption)
                            .lineLimit(2)
                            .foregroundColor(.primary)
                    }
                }
                .buttonStyle(PlainButtonStyle())
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Résultats de recherche

    private func searchResultsList(_ results: GlobalSearchResult) -> some View {
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
                                    Text(String(format: NSLocalizedString("%lld viewers", comment: ""), stream.viewerCount))
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

    // MARK: - Recherches récentes

    private func recordSearch(_ query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Dédup : une même requête remonte en tête en rafraîchissant sa date.
        if let existing = recentSearches.first(where: { $0.query == trimmed }) {
            existing.createdAt = Date()
        } else {
            modelContext.insert(PersistentRecentSearch(query: trimmed))
        }

        // On conserve au plus maxRecentSearches entrées (les plus récentes).
        if let all = try? modelContext.fetch(FetchDescriptor<PersistentRecentSearch>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )), all.count > Self.maxRecentSearches {
            for stale in all.dropFirst(Self.maxRecentSearches) {
                modelContext.delete(stale)
            }
        }

        try? modelContext.save()
    }

    private func clearRecentSearches() {
        for search in recentSearches {
            modelContext.delete(search)
        }
        try? modelContext.save()
    }
}
