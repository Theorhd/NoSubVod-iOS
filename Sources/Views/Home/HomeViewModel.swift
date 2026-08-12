import Foundation
import Combine

@MainActor
final class HomeViewModel: ObservableObject {
    @Published var liveStreams: [LiveStream] = []
    @Published var trendingVODs: [VOD] = []
    @Published var liveSubscriptions: Set<String> = []
    @Published var isLoading = false

    init() {}

    func loadData(history: [PersistentHistoryEntry] = [], subs: [PersistentSubscription] = []) async {
        isLoading = true

        do {
            async let liveReq = TwitchAPIService.shared.fetchLiveStreams(limit: 10)
            async let trendsReq = TwitchAPIService.shared.fetchTrendingVODs(history: history, subs: subs)

            // fetchLiveStatus est throttlé à 30s pour ne pas re-poller à chaque apparition de la vue.
            let subsLive: Set<String>
            if TwitchAPIService.shared.shouldSkipLiveStatusFetch() {
                subsLive = liveSubscriptions
            } else {
                // Échec → liste vide, fallback prévu
                subsLive = (try? await TwitchAPIService.shared.fetchLiveStatus(for: subs.map { $0.login })) ?? []
                TwitchAPIService.shared.markLiveStatusFetched()
            }

            let fetchedLive   = (try? await liveReq)    ?? []
            let fetchedTrends = (try? await trendsReq)  ?? []

            if !Task.isCancelled {
                self.liveStreams       = fetchedLive
                self.trendingVODs      = fetchedTrends
                self.liveSubscriptions = subsLive
                self.isLoading         = false
            }
        } catch {
            AppLogger.shared.log("Erreur de chargement HomeViewModel: \(error)")
            if !Task.isCancelled {
                self.isLoading = false
            }
        }
    }
}
