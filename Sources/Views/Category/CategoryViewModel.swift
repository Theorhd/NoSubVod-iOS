import Foundation
import Combine

@MainActor
final class CategoryViewModel: ObservableObject {
    @Published var lives: [LiveStream] = []
    @Published var vods: [VOD] = []
    @Published var clips: [VOD] = []
    @Published var isLoading = false
    
    let game: Game
    
    init(game: Game) {
        self.game = game
    }
    
    func loadData() async {
        guard lives.isEmpty && vods.isEmpty && clips.isEmpty else { return }
        isLoading = true
        
        do {
            let results = try await TwitchAPIService.shared.fetchCategoryDetails(gameName: game.name)
            if !Task.isCancelled {
                self.lives = results.lives
                self.vods = results.vods
                self.clips = results.clips
                self.isLoading = false
            }
        } catch {
            print("Erreur de chargement pour la catégorie \(game.name): \(error)")
            if !Task.isCancelled {
                self.isLoading = false
            }
        }
    }
}
