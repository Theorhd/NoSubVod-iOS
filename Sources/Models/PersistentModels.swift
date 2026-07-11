import Foundation
import SwiftData

@Model
class PersistentHistoryEntry {
    @Attribute(.unique) var id: UUID
    var vodId: String
    var timecode: Int
    var duration: Int
    var updatedAt: Date
    
    // Cached metadata
    var title: String?
    var streamerName: String?
    var streamerProfileURL: URL?
    var gameName: String?
    var viewCount: Int?
    var previewThumbnailURL: URL?
    
    init(vodId: String, timecode: Int, duration: Int, updatedAt: Date = Date(), title: String? = nil, streamerName: String? = nil, streamerProfileURL: URL? = nil, gameName: String? = nil, viewCount: Int? = nil, previewThumbnailURL: URL? = nil) {
        self.id = UUID()
        self.vodId = vodId
        self.timecode = timecode
        self.duration = duration
        self.updatedAt = updatedAt
        
        self.title = title
        self.streamerName = streamerName
        self.streamerProfileURL = streamerProfileURL
        self.gameName = gameName
        self.viewCount = viewCount
        self.previewThumbnailURL = previewThumbnailURL
    }
}

@Model
class PersistentWatchlistEntry {
    @Attribute(.unique) var id: UUID
    var vodId: String
    var title: String
    var previewThumbnailURL: URL?
    var lengthSeconds: Int
    var addedAt: Date
    
    init(vodId: String, title: String, previewThumbnailURL: URL?, lengthSeconds: Int, addedAt: Date = Date()) {
        self.id = UUID()
        self.vodId = vodId
        self.title = title
        self.previewThumbnailURL = previewThumbnailURL
        self.lengthSeconds = lengthSeconds
        self.addedAt = addedAt
    }
}

@Model
class PersistentSubscription {
    @Attribute(.unique) var login: String
    var displayName: String
    var profileImageURL: URL?
    var addedAt: Date
    
    init(login: String, displayName: String, profileImageURL: URL?, addedAt: Date = Date()) {
        self.login = login
        self.displayName = displayName
        self.profileImageURL = profileImageURL
        self.addedAt = addedAt
    }
}
