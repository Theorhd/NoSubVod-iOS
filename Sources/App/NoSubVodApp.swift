import SwiftUI
import SwiftData
import AVFoundation

@main
struct NoSubVodApp: App {
    init() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Failed to configure audio session: \(error)")
        }
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: [PersistentHistoryEntry.self, PersistentWatchlistEntry.self, PersistentSubscription.self, VODDownload.self])
    }
}

class AppLogger {
    static let shared = AppLogger()
    
    private let logFileURL: URL
    private let queue = DispatchQueue(label: "com.nosubvod.logger")
    
    private init() {
        let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
        logFileURL = paths[0].appendingPathComponent("NoSubVod.log")
        
        if let attr = try? FileManager.default.attributesOfItem(atPath: logFileURL.path),
           let size = attr[.size] as? UInt64, size > 2_000_000 {
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

public func print(_ items: Any..., separator: String = " ", terminator: String = "\n") {
    let message = items.map { "\($0)" }.joined(separator: separator)
    Swift.print(message, terminator: terminator)
    AppLogger.shared.log(message)
}
