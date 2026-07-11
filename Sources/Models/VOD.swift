import Foundation

struct TwitchUser: Codable, Identifiable, Hashable {
    let id: String
    let login: String
    let displayName: String
    let profileImageURL: URL?
    let createdAt: Date?
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
