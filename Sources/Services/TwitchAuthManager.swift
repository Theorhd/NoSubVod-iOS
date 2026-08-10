import Foundation
import Combine

final class TwitchAuthManager: ObservableObject {
    static let shared = TwitchAuthManager()
    
    @Published var isAuthenticated: Bool = false
    @Published var currentUser: TwitchUser?
    
    private let tokenKey = "twitch_access_token"
    
    var accessToken: String? {
        get { UserDefaults.standard.string(forKey: tokenKey) }
        set {
            if let token = newValue {
                UserDefaults.standard.set(token, forKey: tokenKey)
                TwitchAPIService.shared.accessToken = token
                self.isAuthenticated = true
            } else {
                UserDefaults.standard.removeObject(forKey: tokenKey)
                TwitchAPIService.shared.accessToken = nil
                self.isAuthenticated = false
                self.currentUser = nil
            }
        }
    }
    
    private init() {
        if let token = accessToken {
            TwitchAPIService.shared.accessToken = token
            self.isAuthenticated = true
        }
    }
    
    func logout() {
        self.accessToken = nil
    }
}
