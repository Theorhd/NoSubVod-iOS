import Foundation

enum AdBlockMode: String, CaseIterable, Codable {
    case local
    case ttv
    case disabled

    var displayName: String {
        switch self {
        case .local:    return NSLocalizedString("Local (recommended)", comment: "")
        case .ttv:      return NSLocalizedString("TTV Proxy", comment: "")
        case .disabled: return NSLocalizedString("Disabled", comment: "")
        }
    }

    var shortDescription: String {
        switch self {
        case .local:
            return NSLocalizedString("Built-in proxy that cleans the stream locally", comment: "")
        case .ttv:
            return NSLocalizedString("Delegates cleaning to an external proxy server", comment: "")
        case .disabled:
            return NSLocalizedString("No blocking — native Twitch behavior", comment: "")
        }
    }
}
