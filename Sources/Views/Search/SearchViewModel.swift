import Foundation
import Combine

@MainActor
final class SearchViewModel: ObservableObject {
    @Published var searchResults: GlobalSearchResult?
    @Published var isSearching = false
    @Published var popularGames: [Game] = []
    @Published var isLoadingPopular = false

    private var searchTask: Task<Void, Never>?
    private var popularTask: Task<Void, Never>?

    func performSearch(query: String) {
        guard !query.isEmpty else {
            searchTask?.cancel()
            searchResults = nil
            return
        }

        searchTask?.cancel()

        searchTask = Task {
            isSearching = true

            do {
                try await Task.sleep(nanoseconds: 500_000_000)
                guard !Task.isCancelled else { return }

                let results = try await TwitchAPIService.shared.globalSearch(query: query, limit: 20)
                if !Task.isCancelled {
                    self.searchResults = results
                    self.isSearching = false
                }
            } catch {
                if !(error is CancellationError) {
                    AppLogger.shared.log("Erreur de recherche: \(error)")
                }
                if !Task.isCancelled {
                    self.isSearching = false
                }
            }
        }
    }

    /// Catégories populaires — chargées une seule fois pour la section
    /// "Popular Categories" (vide en état d'échec, la section ne s'affiche pas).
    func loadPopularGames() {
        guard popularGames.isEmpty, popularTask == nil else { return }
        popularTask = Task {
            isLoadingPopular = true
            do {
                let games = try await TwitchAPIService.shared.fetchPopularGames(limit: 12)
                if !Task.isCancelled {
                    self.popularGames = games
                    self.isLoadingPopular = false
                }
            } catch {
                if !(error is CancellationError) {
                    AppLogger.shared.log("Erreur de chargement des catégories populaires: \(error)")
                }
                if !Task.isCancelled {
                    self.isLoadingPopular = false
                }
            }
        }
    }
}
