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
        do {
            try modelContext.save()
        } catch {
            AppLogger.shared.log("[DownloadModelActor] Failed to create download for \(vodId): \(error)")
        }
    }

    func setDownloadStateFailed(vodId: String) {
        let descriptor = FetchDescriptor<VODDownload>(predicate: #Predicate { $0.vodId == vodId })
        do {
            if let model = try modelContext.fetch(descriptor).first {
                model.state = .failed
                try modelContext.save()
            }
        } catch {
            AppLogger.shared.log("[DownloadModelActor] Failed to set state failed for \(vodId): \(error)")
        }
    }

    func updateSwiftDataProgress(vodId: String, progress: Double, state: DownloadState) {
        let descriptor = FetchDescriptor<VODDownload>(predicate: #Predicate { $0.vodId == vodId })
        do {
            if let model = try modelContext.fetch(descriptor).first {
                model.progress = progress
                model.state = state
                try modelContext.save()
            }
        } catch {
            AppLogger.shared.log("[DownloadModelActor] Failed to update progress for \(vodId): \(error)")
        }
    }

    /// Atomically marks a download as completed with its local playlist path.
    /// Both `localPlaylistPath` and `state = .completed` are written in a single save,
    /// so `@Query` observers never see `.completed` with a nil path.
    func completeDownload(vodId: String, playlistPath: String, durationSeconds: Double? = nil) {
        let descriptor = FetchDescriptor<VODDownload>(predicate: #Predicate { $0.vodId == vodId })
        do {
            if let model = try modelContext.fetch(descriptor).first {
                model.localPlaylistPath = playlistPath
                model.progress = 1.0
                model.state = .completed
                model.durationSeconds = durationSeconds
                try modelContext.save()
            }
        } catch {
            AppLogger.shared.log("[DownloadModelActor] Failed to complete download for \(vodId): \(error)")
        }
    }

    func fetchInterruptedDownloads() -> [VODDownload] {
        let descriptor = FetchDescriptor<VODDownload>(predicate: #Predicate { $0.stateRaw == "downloading" })
        do {
            return try modelContext.fetch(descriptor)
        } catch {
            AppLogger.shared.log("[DownloadModelActor] Failed to fetch interrupted downloads: \(error)")
            return []
        }
    }

    func deleteDownload(vodId: String) {
        let descriptor = FetchDescriptor<VODDownload>(predicate: #Predicate { $0.vodId == vodId })
        do {
            if let model = try modelContext.fetch(descriptor).first {
                modelContext.delete(model)
                try modelContext.save()
            }
        } catch {
            AppLogger.shared.log("[DownloadModelActor] Failed to delete download for \(vodId): \(error)")
        }
    }
}
