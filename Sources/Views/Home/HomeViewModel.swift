import Foundation
import Combine

@MainActor
class HomeViewModel: ObservableObject {
    @Published var liveStreams: [LiveStream] = []
    @Published var trendingVODs: [VOD] = []
    @Published var isLoading = false
    
    init() {
        loadData()
    }
    
    func loadData(history: [PersistentHistoryEntry] = [], subs: [PersistentSubscription] = []) {
        isLoading = true
        
        Task {
            do {
                // Requêtes asynchrones en parallèle
                async let liveReq = TwitchAPIService.shared.fetchLiveStreams(limit: 10)
                async let trendsReq = TwitchAPIService.shared.fetchTrendingVODs(history: history, subs: subs)
                
                let fetchedLive = (try? await liveReq) ?? []
                let fetchedTrends = (try? await trendsReq) ?? []
                
                DispatchQueue.main.async {
                    self.liveStreams = fetchedLive
                    self.trendingVODs = fetchedTrends
                    self.isLoading = false
                }
            } catch {
                print("Erreur de chargement HomeViewModel: \\(error)")
                DispatchQueue.main.async {
                    self.isLoading = false
                }
            }
        }
    }
}
