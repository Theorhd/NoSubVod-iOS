import SwiftUI
import SwiftData
import AVFoundation
import os

extension Logger {
    private static var subsystem = Bundle.main.bundleIdentifier ?? "com.nosubvod"

    static let app = Logger(subsystem: subsystem, category: "App")
    static let player = Logger(subsystem: subsystem, category: "Player")
    static let auth = Logger(subsystem: subsystem, category: "Auth")
    static let network = Logger(subsystem: subsystem, category: "Network")
    static let download = Logger(subsystem: subsystem, category: "Download")
}

@main
struct NoSubVodApp: App {
    var sharedModelContainer: ModelContainer
    
    init() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            Logger.app.error("Failed to configure audio session: \(error.localizedDescription)")
        }
        
        LiveContainerStorageManager.shared.setup()
        
        let schema = Schema([PersistentHistoryEntry.self, PersistentWatchlistEntry.self, PersistentSubscription.self, PersistentRecentSearch.self, VODDownload.self])
        let isLiveContainer = UserDefaults.standard.bool(forKey: "isLiveContainerStorageEnabled")
        
        var modelConfiguration: ModelConfiguration
        if isLiveContainer {
            let storeURL = FileManager.documentsDirectory.appendingPathComponent("NoSubVod_LiveContainer.sqlite")
            modelConfiguration = ModelConfiguration(url: storeURL)
        } else {
            modelConfiguration = ModelConfiguration()
        }
        
        do {
            sharedModelContainer = try ModelContainer(for: schema, configurations: modelConfiguration)
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
        }
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(sharedModelContainer)
    }
}

/// Lightweight compatibility wrapper around `os.Logger` for generic application logs.
final class AppLogger: @unchecked Sendable {
    static let shared = AppLogger()
    
    private init() {}
    
    func log(_ message: String) {
        Logger.app.info("\(message, privacy: .public)")
    }
}

