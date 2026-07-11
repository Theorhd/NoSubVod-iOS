import Foundation
import Combine

@MainActor
class SearchViewModel: ObservableObject {
    @Published var searchResults: GlobalSearchResult?
    @Published var isSearching = false
    
    func performSearch(query: String) {
        guard !query.isEmpty else {
            self.searchResults = nil
            return
        }
        
        isSearching = true
        
        Task {
            do {
                let results = try await TwitchAPIService.shared.globalSearch(query: query, limit: 20)
                DispatchQueue.main.async {
                    self.searchResults = results
                    self.isSearching = false
                }
            } catch {
                print("Erreur de recherche: \(error)")
                DispatchQueue.main.async {
                    self.isSearching = false
                }
            }
        }
    }
}
