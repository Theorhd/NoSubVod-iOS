import Foundation

struct ChatMessage: Codable, Identifiable, Hashable {
    let id: String
    let commenter: ChatCommenter
    let message: ChatMessageContent
    let contentOffsetSeconds: Int
    let createdAt: Date
}

struct ChatCommenter: Codable, Hashable {
    let displayName: String
    let login: String
    let profileImageURL: URL?
    /// Couleur native IRC du pseudo (ex: "#FF0000"), nil si non renseignée.
    let colorHex: String?
}

struct ChatMessageContent: Codable, Hashable {
    let fragments: [ChatFragment]
}

struct ChatFragment: Codable, Hashable {
    let text: String
    let emote: ChatEmote?
}

struct ChatEmote: Codable, Hashable {
    let id: String
}
