import Foundation
import Combine

@MainActor
class HomeViewModel: ObservableObject {
    @Published var liveStreams: [LiveStream] = []
    @Published var trendingVODs: [VOD] = []
    @Published var liveSubscriptions: Set<String> = []
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
                async let subsLiveReq = TwitchAPIService.shared.fetchLiveStatus(for: subs.map { $0.login })
                
                let fetchedLive = (try? await liveReq) ?? []
                let fetchedTrends = (try? await trendsReq) ?? []
                let fetchedSubsLive = (try? await subsLiveReq) ?? []
                
                DispatchQueue.main.async {
                    self.liveStreams = fetchedLive
                    self.trendingVODs = fetchedTrends
                    self.liveSubscriptions = fetchedSubsLive
                    self.isLoading = false
                }
            } catch {
                print("Erreur de chargement HomeViewModel: \(error)")
                DispatchQueue.main.async {
                    self.isLoading = false
                }
            }
        }
    }
}
