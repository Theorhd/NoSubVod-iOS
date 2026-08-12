import SwiftUI
import SwiftData
import AVFoundation

@main
struct NoSubVodApp: App {
    var sharedModelContainer: ModelContainer
    
    init() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            AppLogger.shared.log("Failed to configure audio session: \(error)")
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

final class AppLogger {
    static let shared = AppLogger()
    
    private let logFileURL: URL
    private let queue = DispatchQueue(label: "com.nosubvod.logger")
    
    private init() {
        logFileURL = FileManager.documentsDirectory.appendingPathComponent("NoSubVod.log")
        
        if let attr = try? FileManager.default.attributesOfItem(atPath: logFileURL.path),
           let size = attr[.size] as? UInt64, size > 2_000_000 {
            // Best-effort : AppLogger ne peut pas se logger lui-même pendant son init
            try? FileManager.default.removeItem(at: logFileURL)
        }
    }
    
    func log(_ message: String) {
        queue.async {
            let formatter = ISO8601DateFormatter()
            let timestamp = formatter.string(from: Date())
            let formatted = "[\(timestamp)] \(message)\n"
            
            if let data = formatted.data(using: .utf8) {
                if FileManager.default.fileExists(atPath: self.logFileURL.path) {
                    if let fileHandle = try? FileHandle(forWritingTo: self.logFileURL) {
                        fileHandle.seekToEndOfFile()
                        fileHandle.write(data)
                        fileHandle.closeFile()
                    }
                } else {
                    try? data.write(to: self.logFileURL)
                }
            }
        }
    }
    
    func getLogFileURL() -> URL {
        if !FileManager.default.fileExists(atPath: logFileURL.path) {
            let initialLog = "--- App Logs ---\n".data(using: .utf8)
            try? initialLog?.write(to: logFileURL)
        }
        return logFileURL
    }
}
