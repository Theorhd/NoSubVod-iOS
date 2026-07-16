import SwiftUI

struct ContentView: View {
    @StateObject private var authManager = TwitchAuthManager.shared
    
    var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Label("Home", systemImage: "house")
                }
            
            SearchView()
                .tabItem {
                    Label("Search", systemImage: "magnifyingglass")
                }
            
            HistoryView()
                .tabItem {
                    Label("History", systemImage: "clock")
                }
            
            DownloadsView()
                .tabItem {
                    Label("Downloads", systemImage: "arrow.down.circle")
                }
        }
        .tint(.purple) // Twitch brand color
        .preferredColorScheme(.dark)
    }
}

#Preview {
    ContentView()
}
