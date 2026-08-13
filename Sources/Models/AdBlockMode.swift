import Foundation

enum AdBlockMode: String, CaseIterable, Codable {
    case local
    case external
    case ttv
    case disabled

    var displayName: String {
        switch self {
        case .local:    return NSLocalizedString("Local", comment: "")
        case .external: return NSLocalizedString("External Proxy", comment: "")
        case .ttv:      return NSLocalizedString("TTV Proxy", comment: "")
        case .disabled: return NSLocalizedString("Disabled", comment: "")
        }
    }

    var shortDescription: String {
        switch self {
        case .local:
            return NSLocalizedString("Built-in proxy that cleans the stream locally - Currently, the player may turn black for 5 to 15 seconds at the start of playback.", comment: "")
        case .external:
            return NSLocalizedString("Routes the stream through an HTTP proxy in an ad-free country — auto-fetched from the free lists when no URL is set", comment: "")
        case .ttv:
            return NSLocalizedString("Delegates cleaning to an external proxy server", comment: "")
        case .disabled:
            return NSLocalizedString("No blocking — native Twitch behavior", comment: "")
        }
    }
}
