import Foundation

struct LiveStreamBroadcaster: Codable, Hashable {
    let id: String
    let login: String
    let displayName: String
    let profileImageURL: URL?
}

struct LiveStream: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let previewImageURL: URL?
    let viewerCount: Int
    let language: String?
    let startedAt: Date
    let broadcaster: LiveStreamBroadcaster
    let game: Game?
}

struct LiveStreamsPage: Codable {
    let items: [LiveStream]
    let nextCursor: String?
    let hasMore: Bool
}
