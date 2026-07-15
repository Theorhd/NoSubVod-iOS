import Foundation
import SwiftData

@ModelActor
actor DownloadModelActor {
    
    func createDownload(
        vodId: String,
        title: String,
        thumbnailURL: URL?,
        isSegment: Bool,
        startTime: Int?,
        endTime: Int?,
        quality: String?,
        streamerName: String? = nil,
        streamerProfileURL: URL? = nil,
        gameName: String? = nil,
        viewCount: Int? = nil
    ) {
        let download = VODDownload(
            vodId: vodId,
            title: title,
            thumbnailURL: thumbnailURL,
            isSegment: isSegment,
            startTime: startTime,
            endTime: endTime,
            quality: quality,
            streamerName: streamerName,
            streamerProfileURL: streamerProfileURL,
            gameName: gameName,
            viewCount: viewCount
        )
        modelContext.insert(download)
        try? modelContext.save()
    }
    
    func setDownloadStateFailed(vodId: String) {
        let descriptor = FetchDescriptor<VODDownload>(predicate: #Predicate { $0.vodId == vodId })
        if let model = try? modelContext.fetch(descriptor).first {
            model.state = .failed
            try? modelContext.save()
        }
    }
    
    func updateSwiftDataProgress(vodId: String, progress: Double, state: DownloadState) {
        let descriptor = FetchDescriptor<VODDownload>(predicate: #Predicate { $0.vodId == vodId })
        if let model = try? modelContext.fetch(descriptor).first {
            model.progress = progress
            model.state = state
            try? modelContext.save()
        }
    }
    
    /// Atomically marks a download as completed with its local playlist path.
    /// Both `localPlaylistPath` and `state = .completed` are written in a single save,
    /// so `@Query` observers never see `.completed` with a nil path.
    func completeDownload(vodId: String, playlistPath: String) {
        let descriptor = FetchDescriptor<VODDownload>(predicate: #Predicate { $0.vodId == vodId })
        if let model = try? modelContext.fetch(descriptor).first {
            model.localPlaylistPath = playlistPath
            model.progress = 1.0
            model.state = .completed
            try? modelContext.save()
        }
    }
    
    func fetchInterruptedDownloads() -> [VODDownload] {
        let descriptor = FetchDescriptor<VODDownload>(predicate: #Predicate { $0.stateRaw == "downloading" })
        return (try? modelContext.fetch(descriptor)) ?? []
    }
    
    func deleteDownload(vodId: String) {
        let descriptor = FetchDescriptor<VODDownload>(predicate: #Predicate { $0.vodId == vodId })
        if let model = try? modelContext.fetch(descriptor).first {
            modelContext.delete(model)
            try? modelContext.save()
        }
    }
}
