import Foundation

struct HistoryEntry: Codable, Identifiable, Hashable {
    let id = UUID()
    let vodId: String
    let timecode: Int
    let duration: Int
    let updatedAt: Date
    
    enum CodingKeys: String, CodingKey {
        case vodId, timecode, duration, updatedAt
    }
}

struct WatchlistEntry: Codable, Identifiable, Hashable {
    let id = UUID()
    let vodId: String
    let title: String
    let previewThumbnailURL: URL?
    let lengthSeconds: Int
    let addedAt: Date
    
    enum CodingKeys: String, CodingKey {
        case vodId, title, previewThumbnailURL, lengthSeconds, addedAt
    }
}
