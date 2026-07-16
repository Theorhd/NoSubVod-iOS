import Foundation
import Combine

@MainActor
class SearchViewModel: ObservableObject {
    @Published var searchResults: GlobalSearchResult?
    @Published var isSearching = false

    private var searchTask: Task<Void, Never>?

    func performSearch(query: String) {
        guard !query.isEmpty else {
            searchTask?.cancel()
            searchResults = nil
            return
        }

        // Annuler la Task précédente pour éviter d'avoir plusieurs requêtes en vol simultanément.
        searchTask?.cancel()

        searchTask = Task {
            isSearching = true

            do {
                // Debounce de 500ms — évite une requête à chaque frappe clavier.
                try await Task.sleep(nanoseconds: 500_000_000)
                guard !Task.isCancelled else { return }

                let results = try await TwitchAPIService.shared.globalSearch(query: query, limit: 20)
                if !Task.isCancelled {
                    self.searchResults = results
                    self.isSearching = false
                }
            } catch {
                if !(error is CancellationError) {
                    print("Erreur de recherche: \(error)")
                }
                if !Task.isCancelled {
                    self.isSearching = false
                }
            }
        }
    }
}
