import Foundation
import SwiftData

@ModelActor
actor HistoryManagerActor {
    func updateHistory(
        vodId: String,
        timecode: Int,
        duration: Int,
        title: String?,
        streamerName: String?,
        streamerProfileURL: URL?,
        gameName: String?,
        viewCount: Int?,
        previewThumbnailURL: URL?
    ) {
        let descriptor = FetchDescriptor<PersistentHistoryEntry>(predicate: #Predicate { $0.vodId == vodId })
        if let existing = try? modelContext.fetch(descriptor).first {
            existing.timecode = timecode
            existing.duration = duration
            existing.updatedAt = Date()
            
            if let title = title { existing.title = title }
            if let streamerName = streamerName { existing.streamerName = streamerName }
            if let streamerProfileURL = streamerProfileURL { existing.streamerProfileURL = streamerProfileURL }
            if let gameName = gameName { existing.gameName = gameName }
            if let viewCount = viewCount { existing.viewCount = viewCount }
            if let previewThumbnailURL = previewThumbnailURL { existing.previewThumbnailURL = previewThumbnailURL }
        } else {
            let entry = PersistentHistoryEntry(
                vodId: vodId,
                timecode: timecode,
                duration: duration,
                updatedAt: Date(),
                title: title,
                streamerName: streamerName,
                streamerProfileURL: streamerProfileURL,
                gameName: gameName,
                viewCount: viewCount,
                previewThumbnailURL: previewThumbnailURL
            )
            modelContext.insert(entry)
        }
        try? modelContext.save()
    }
}
