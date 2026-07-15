import Foundation
import SwiftData

@Model
class VODDownload {
    @Attribute(.unique) var id: UUID
    var vodId: String
    var title: String
    var thumbnailURL: URL?
    var isSegment: Bool
    var startTime: Int?
    var endTime: Int?
    var quality: String?
    
    var streamerName: String?
    var streamerProfileURL: URL?
    var gameName: String?
    var viewCount: Int?
    
    // progress is 0.0 to 1.0
    var progress: Double
    var stateRaw: String // "downloading", "paused", "completed", "failed"
    var localPlaylistPath: String? // relative to documents directory
    
    var addedAt: Date
    
    @Transient
    var state: DownloadState {
        get { DownloadState(rawValue: stateRaw) ?? .failed }
        set { stateRaw = newValue.rawValue }
    }
    
    init(vodId: String, title: String, thumbnailURL: URL?, isSegment: Bool = false, startTime: Int? = nil, endTime: Int? = nil, quality: String? = nil, streamerName: String? = nil, streamerProfileURL: URL? = nil, gameName: String? = nil, viewCount: Int? = nil) {
        self.id = UUID()
        self.vodId = vodId
        self.title = title
        self.thumbnailURL = thumbnailURL
        self.isSegment = isSegment
        self.startTime = startTime
        self.endTime = endTime
        self.quality = quality
        
        self.streamerName = streamerName
        self.streamerProfileURL = streamerProfileURL
        self.gameName = gameName
        self.viewCount = viewCount
        
        self.progress = 0.0
        self.stateRaw = DownloadState.downloading.rawValue
        self.addedAt = Date()
    }
}

enum DownloadState: String, Codable {
    case downloading
    case paused
    case completed
    case failed
}
