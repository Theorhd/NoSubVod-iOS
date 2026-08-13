import Foundation

struct TwitchUser: Codable, Identifiable, Hashable {
    let id: String
    let login: String
    let displayName: String
    let profileImageURL: URL?
    let createdAt: Date?

    // Helix renvoie du snake_case — les CodingKeys sont requis pour le décodage.
    enum CodingKeys: String, CodingKey {
        case id, login
        case displayName = "display_name"
        case profileImageURL = "profile_image_url"
        case createdAt = "created_at"
    }
}

struct VODOwner: Codable, Hashable {
    let login: String
    let displayName: String
    let profileImageURL: URL?
}

struct Game: Codable, Hashable {
    let id: String?
    let name: String
    let boxArtURL: URL?
}

struct VOD: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let lengthSeconds: Int
    let previewThumbnailURL: URL?
    let createdAt: Date
    let viewCount: Int
    let language: String?
    let broadcastType: String?
    let game: Game?
    let owner: VODOwner?
}
