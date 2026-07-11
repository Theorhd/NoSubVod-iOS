import Foundation
import Combine

@MainActor
class CategoryViewModel: ObservableObject {
    @Published var lives: [LiveStream] = []
    @Published var vods: [VOD] = []
    @Published var clips: [VOD] = []
    @Published var isLoading = false
    
    let game: Game
    
    init(game: Game) {
        self.game = game
    }
    
    func loadData() {
        guard lives.isEmpty && vods.isEmpty && clips.isEmpty else { return }
        isLoading = true
        
        Task {
            do {
                let results = try await TwitchAPIService.shared.fetchCategoryDetails(gameName: game.name)
                DispatchQueue.main.async {
                    self.lives = results.lives
                    self.vods = results.vods
                    self.clips = results.clips
                    self.isLoading = false
                }
            } catch {
                print("Erreur de chargement pour la catégorie \(game.name): \(error)")
                DispatchQueue.main.async {
                    self.isLoading = false
                }
            }
        }
    }
}
