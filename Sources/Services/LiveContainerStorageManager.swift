import Foundation
import Combine

struct LiveContainerPrefs: Codable {
    var defaultVideoQuality: String?
    var isDebugModeEnabled: Bool?
    var isLiveContainerStorageEnabled: Bool?
    var twitch_access_token: String?
}

final class LiveContainerStorageManager {
    static let shared = LiveContainerStorageManager()

    private let prefsURL: URL
    private var observer: AnyCancellable?

    var defaults: UserDefaults = .standard
    var fileManager: FileManager = .default

    private init() {
        let paths = self.fileManager.urls(for: .documentDirectory, in: .userDomainMask)
        prefsURL = paths[0].appendingPathComponent("LiveContainerPrefs.json")
    }
    
    func setup() {
        restoreIfNeeded()
        
        observer = NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)
            .sink { [weak self] _ in
                // Use a small delay or just dispatch async to avoid multiple saves
                DispatchQueue.main.async {
                    self?.saveIfNeeded()
                }
            }
    }
    
    var isEnabled: Bool {
        self.defaults.bool(forKey: "isLiveContainerStorageEnabled")
    }
    
    private func restoreIfNeeded() {
        guard self.fileManager.fileExists(atPath: prefsURL.path) else { return }
        
        do {
            let data = try Data(contentsOf: prefsURL)
            let prefs = try JSONDecoder().decode(LiveContainerPrefs.self, from: data)
            
            if prefs.isLiveContainerStorageEnabled == true {
                if let quality = prefs.defaultVideoQuality {
                    self.defaults.set(quality, forKey: "defaultVideoQuality")
                }
                if let debug = prefs.isDebugModeEnabled {
                    self.defaults.set(debug, forKey: "isDebugModeEnabled")
                }
                if let token = prefs.twitch_access_token {
                    self.defaults.set(token, forKey: "twitch_access_token")
                }
                self.defaults.set(true, forKey: "isLiveContainerStorageEnabled")
                print("Restored UserDefaults from LiveContainerPrefs.json")
            }
        } catch {
            print("Failed to restore LiveContainerPrefs: \(error)")
        }
    }
    
    private func saveIfNeeded() {
        guard isEnabled else {
            if self.fileManager.fileExists(atPath: prefsURL.path) {
                try? self.fileManager.removeItem(at: prefsURL)
            }
            return
        }
        
        var prefs = LiveContainerPrefs()
        prefs.isLiveContainerStorageEnabled = true
        
        if let quality = self.defaults.string(forKey: "defaultVideoQuality") {
            prefs.defaultVideoQuality = quality
        }
        
        prefs.isDebugModeEnabled = self.defaults.bool(forKey: "isDebugModeEnabled")
        
        if let token = self.defaults.string(forKey: "twitch_access_token") {
            prefs.twitch_access_token = token
        }
        
        do {
            let data = try JSONEncoder().encode(prefs)
            try data.write(to: prefsURL)
        } catch {
            print("Failed to save LiveContainerPrefs: \(error)")
        }
    }
}
