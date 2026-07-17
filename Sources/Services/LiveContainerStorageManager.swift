import Foundation
import Combine

struct LiveContainerPrefs: Codable {
    var defaultVideoQuality: String?
    var isDebugModeEnabled: Bool?
    var isLiveContainerStorageEnabled: Bool?
    var twitch_access_token: String?
}

class LiveContainerStorageManager {
    static let shared = LiveContainerStorageManager()
    
    private let prefsURL: URL
    private var observer: AnyCancellable?
    
    private init() {
        let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
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
        UserDefaults.standard.bool(forKey: "isLiveContainerStorageEnabled")
    }
    
    private func restoreIfNeeded() {
        guard FileManager.default.fileExists(atPath: prefsURL.path) else { return }
        
        do {
            let data = try Data(contentsOf: prefsURL)
            let prefs = try JSONDecoder().decode(LiveContainerPrefs.self, from: data)
            
            if prefs.isLiveContainerStorageEnabled == true {
                if let quality = prefs.defaultVideoQuality {
                    UserDefaults.standard.set(quality, forKey: "defaultVideoQuality")
                }
                if let debug = prefs.isDebugModeEnabled {
                    UserDefaults.standard.set(debug, forKey: "isDebugModeEnabled")
                }
                if let token = prefs.twitch_access_token {
                    UserDefaults.standard.set(token, forKey: "twitch_access_token")
                }
                UserDefaults.standard.set(true, forKey: "isLiveContainerStorageEnabled")
                print("Restored UserDefaults from LiveContainerPrefs.json")
            }
        } catch {
            print("Failed to restore LiveContainerPrefs: \(error)")
        }
    }
    
    private func saveIfNeeded() {
        guard isEnabled else {
            if FileManager.default.fileExists(atPath: prefsURL.path) {
                try? FileManager.default.removeItem(at: prefsURL)
            }
            return
        }
        
        var prefs = LiveContainerPrefs()
        prefs.isLiveContainerStorageEnabled = true
        
        if let quality = UserDefaults.standard.string(forKey: "defaultVideoQuality") {
            prefs.defaultVideoQuality = quality
        }
        
        prefs.isDebugModeEnabled = UserDefaults.standard.bool(forKey: "isDebugModeEnabled")
        
        if let token = UserDefaults.standard.string(forKey: "twitch_access_token") {
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
