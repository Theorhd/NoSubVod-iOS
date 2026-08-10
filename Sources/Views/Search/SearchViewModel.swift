import Foundation
import Combine

@MainActor
final class SearchViewModel: ObservableObject {
    @Published var searchResults: GlobalSearchResult?
    @Published var isSearching = false

    private var searchTask: Task<Void, Never>?

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
                    print("Erreur de recherche: \(error)")
                }
                if !Task.isCancelled {
                    self.isSearching = false
                }
            }
        }
    }
}
