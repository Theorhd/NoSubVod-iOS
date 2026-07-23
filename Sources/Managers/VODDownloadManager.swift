import Foundation
import SwiftData
import Combine
import SwiftUI
import AVFoundation
import CoreMedia

class VODDownloadManager: NSObject, ObservableObject, URLSessionDownloadDelegate {
    static let shared = VODDownloadManager()

    @Published var activeDownloads: [String: Double] = [:]

    // For throttling UI updates and DB writes
    private var lastProgressUpdate: [String: Date] = [:]
    private var lastProgressValue: [String: Double] = [:]
    private var downloadActor: DownloadModelActor?

    private var downloadTasks: [Int: String] = [:]

    // Instead of an active-tasks list, we maintain a queue of pending chunk URLs for each VOD.
    private var pendingChunks: [String: [ChunkInfo]] = [:]
    private var activeChunkTasks: [String: [URLSessionDownloadTask]] = [:]

    private var expectedChunksCount: [String: Int] = [:]
    private var completedChunksCount: [String: Int] = [:]
    private var orderedChunks: [String: [ChunkInfo]] = [:]
    private var firstMapFilenames: [String: String] = [:]

    private let maxConcurrentChunksPerVOD = 4

    // Track progress of individual tasks
    private var taskProgress: [Int: Double] = [:]
    
    private var cancellables = Set<AnyCancellable>()

    private lazy var urlSession: URLSession = {
        // Use .default (not .background) because Twitch Cloudfront URLs are signed
        // and expire quickly. A background session can defer task start, causing
        // all chunk URLs to expire before they are fetched → download stays at 0%.
        let config = URLSessionConfiguration.default
        config.httpMaximumConnectionsPerHost = 4
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 300
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private override init() {
        super.init()
        
        NetworkMonitor.shared.$isCellular
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isCellular in
                if isCellular {
                    self?.cancelDownloadsIfOnCellularAndRestricted()
                }
            }
            .store(in: &cancellables)
    }

    func startDownload(
        vodId: String,
        title: String,
        thumbnailURL: URL?,
        isSegment: Bool,
        startTime: Int?,
        endTime: Int?,
        quality: String? = nil,
        streamerName: String? = nil,
        streamerProfileURL: URL? = nil,
        gameName: String? = nil,
        viewCount: Int? = nil,
        modelContext: ModelContext
    ) {
        if downloadActor == nil {
            downloadActor = DownloadModelActor(modelContainer: modelContext.container)
        }
        
        let actor = self.downloadActor
        Task {
            await actor?.createDownload(
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
        }

        let preference = UserDefaults.standard.string(forKey: "downloadNetworkPreference") ?? "all"
        if NetworkMonitor.shared.isCellular && preference == "wifi" {
            AppLogger.shared.log("Download \(vodId) paused immediately: Wi-Fi only preference active while on cellular data.")
            Task {
                await actor?.updateSwiftDataProgress(vodId: vodId, progress: 0.0, state: .paused)
            }
            return
        }

        activeDownloads[vodId] = 0.0
        lastProgressUpdate[vodId] = Date()
        lastProgressValue[vodId] = 0.0

        // Keep screen awake during download.
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = true
        }

        Task {
            do {
                AppLogger.shared.log("Starting download for VOD: \(vodId)")
                let playlistURL = try await TwitchHLSManager.shared.fetchPlaylistURL(
                    videoID: vodId,
                    isLive: false,
                    quality: quality
                )

                let (data, _) = try await URLSession.shared.data(from: playlistURL)
                guard let playlistString = String(data: data, encoding: .utf8) else {
                    throw URLError(.badServerResponse)
                }

                let (chunks, _, _, firstMapFilename, initSegmentURLs) = parsePlaylist(
                    playlist: playlistString,
                    baseURL: playlistURL,
                    isSegment: isSegment,
                    startTime: startTime,
                    endTime: endTime
                )

                guard !chunks.isEmpty else {
                    AppLogger.shared.log("Error: No chunks parsed for VOD \(vodId)")
                    await setDownloadStateFailed(vodId: vodId)
                    return
                }

                AppLogger.shared.log("Parsed \(chunks.count) chunks for VOD \(vodId)")

                await MainActor.run {
                    self.expectedChunksCount[vodId] = chunks.count
                    self.orderedChunks[vodId] = chunks
                    if let firstMap = firstMapFilename {
                        self.firstMapFilenames[vodId] = firstMap
                    }
                    self.completedChunksCount[vodId] = 0
                    self.pendingChunks[vodId] = chunks
                    self.activeChunkTasks[vodId] = []
                }

                let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                let vodDirectory = documentsPath
                    .appendingPathComponent("downloads")
                    .appendingPathComponent(vodId)

                if !FileManager.default.fileExists(atPath: vodDirectory.path) {
                    try FileManager.default.createDirectory(
                        at: vodDirectory,
                        withIntermediateDirectories: true,
                        attributes: nil
                    )
                }

                // Download fMP4 init segments synchronously before chunks.
                // These are referenced by #EXT-X-MAP tags in the playlist and MUST be present
                // on disk for AVPlayer to decode the fMP4 chunks — missing them causes a black screen.
                for initURL in initSegmentURLs {
                    let localFilename = initURL.lastPathComponent
                    let destURL = vodDirectory.appendingPathComponent(localFilename)
                    if !FileManager.default.fileExists(atPath: destURL.path) {
                        AppLogger.shared.log("Downloading init segment: \(localFilename) for VOD \(vodId)")
                        let (initData, _) = try await URLSession.shared.data(from: initURL)
                        try initData.write(to: destURL)
                    }
                }

                // Chunks will be processed in remuxToMP4 once all downloads complete:
                // - fMP4 → local index.m3u8 (keeps all files)
                // - TS  → binary concat into video.ts (writes segments.json + duration).
                
                await MainActor.run {
                    self.processNextChunks(for: vodId)
                }

            } catch {
                AppLogger.shared.log("Failed to start VOD download: \(error)")
                await setDownloadStateFailed(vodId: vodId)
            }
        }
    }

    private func setDownloadStateFailed(vodId: String) async {
        await downloadActor?.setDownloadStateFailed(vodId: vodId)
        AppLogger.shared.log("Marked VOD \(vodId) as failed")
    }


    struct ChunkInfo {
        let remoteURL: URL
        let duration: Double
        let filename: String
        /// Filename of the next #EXT-X-MAP init segment that follows this chunk (mid-playlist MAP change)
        var nextMapFilename: String? = nil
        /// Mid-playlist HLS tags (e.g. #EXT-X-DISCONTINUITY) that appear after this chunk
        var trailingTags: [String] = []
    }

    /// Parse la playlist HLS Twitch et extrait les chunks à télécharger.
    /// Retourne uniquement les données nécessaires pour construire un header local propre —
    /// on ne copie JAMAIS le header Twitch brut car il contient des URLs HTTPS (PREFETCH tags, etc.)
    /// qu'AVPlayer tenterait de résoudre réseau au lieu d'utiliser les fichiers locaux.
    private func parsePlaylist(
        playlist: String,
        baseURL: URL,
        isSegment: Bool,
        startTime: Int?,
        endTime: Int?
    ) -> (chunks: [ChunkInfo], targetDuration: Int, version: Int, firstMapFilename: String?, initSegmentURLs: [URL]) {
        var chunks: [ChunkInfo] = []
        let lines = playlist.components(separatedBy: .newlines)

        var targetDuration: Int = 10
        var version: Int = 3
        var firstMapFilename: String? = nil
        var initSegmentURLs: [URL] = []
        // Tracks init URIs already seen to avoid duplicates
        var seenInitURIs: Set<String> = []

        var currentDuration: Double?
        var totalTime: Double = 0

        let start = Double(startTime ?? 0)
        let end = Double(endTime ?? Int.max)

        var inHeader = true
        // The most recent init segment filename seen while parsing (used for mid-playlist MAP tags)
        var pendingNextMapFilename: String? = nil

        for line in lines {
            let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmedLine.isEmpty { continue }

            if trimmedLine.hasPrefix("#EXT-X-ENDLIST") {
                // #EXT-X-ENDLIST is hardcoded into the local playlist builder — skip here.
                continue
            }

            // #EXT-X-MAP can appear in the header OR between segments (multiple init segments).
            if trimmedLine.hasPrefix("#EXT-X-MAP:") {
                if let uriRange = trimmedLine.range(of: "URI=\""),
                   let endQuote = trimmedLine.range(of: "\"", range: uriRange.upperBound..<trimmedLine.endIndex) {
                    let uriString = String(trimmedLine[uriRange.upperBound..<endQuote.lowerBound])
                    if let resolvedURL = URL(string: uriString, relativeTo: baseURL)?.absoluteURL {
                        let localFilename = resolvedURL.lastPathComponent
                        if !seenInitURIs.contains(uriString) {
                            seenInitURIs.insert(uriString)
                            initSegmentURLs.append(resolvedURL)
                        }
                        if inHeader {
                            // Record the first MAP filename for the local header
                            if firstMapFilename == nil { firstMapFilename = localFilename }
                        } else {
                            // Mid-playlist MAP change — record it so it can be attached to the
                            // last *included* chunk (not just the previous raw chunk, which may
                            // have been filtered out by the segment time window).
                            pendingNextMapFilename = localFilename
                        }
                    }
                }
                continue
            }

            if trimmedLine.hasPrefix("#EXTINF:") {
                inHeader = false
                let durationStr = trimmedLine
                    .replacingOccurrences(of: "#EXTINF:", with: "")
                    .replacingOccurrences(of: ",", with: "")
                    .trimmingCharacters(in: .whitespaces)
                currentDuration = Double(durationStr)
                continue
            }

            if inHeader {
                // Only extract #EXT-X-TARGETDURATION and #EXT-X-VERSION from the Twitch header.
                // Skip all other Twitch-specific tags to avoid HTTPS CDN URLs leaking into
                // the local m3u8 where AVPlayer would attempt network resolution.
                if trimmedLine.hasPrefix("#EXT-X-TARGETDURATION:") {
                    let val = trimmedLine.replacingOccurrences(of: "#EXT-X-TARGETDURATION:", with: "")
                    targetDuration = Int(val.trimmingCharacters(in: .whitespaces)) ?? 10
                } else if trimmedLine.hasPrefix("#EXT-X-VERSION:") {
                    let val = trimmedLine.replacingOccurrences(of: "#EXT-X-VERSION:", with: "")
                    version = Int(val.trimmingCharacters(in: .whitespaces)) ?? 3
                }
                continue
            }

            // Mid-playlist tags like #EXT-X-DISCONTINUITY — collect them as pending metadata.
            if trimmedLine.hasPrefix("#") {
                if !chunks.isEmpty {
                    chunks[chunks.count - 1].trailingTags.append(trimmedLine)
                }
                continue
            }

            // Segment URL line
            if let duration = currentDuration {
                let chunkStart = totalTime
                let chunkEnd = totalTime + duration

                let isWithinSegment = !isSegment || (chunkEnd > start && chunkStart < end)

                if isWithinSegment {
                    if let chunkURL = URL(string: trimmedLine, relativeTo: baseURL)?.absoluteURL {
                        let filename = chunkURL.lastPathComponent
                        var chunk = ChunkInfo(remoteURL: chunkURL, duration: duration, filename: filename)

                        // Attach any pending MAP change to this chunk (the first included chunk
                        // after a mid-playlist MAP tag), not the raw previous chunk.
                        if let pending = pendingNextMapFilename {
                            chunk.nextMapFilename = pending
                            pendingNextMapFilename = nil
                        }

                        chunks.append(chunk)
                    }
                }

                totalTime += duration
            }
            currentDuration = nil
        }

        // fMP4/CMAF content uses #EXT-X-MAP which requires HLS version >= 5 (version 6 for CMAF).
        // Enforce minimum version 6 when MAP is present so AVPlayer doesn't silently ignore the
        // init segment — without it fMP4 chunks have no initialization data → black screen.
        let effectiveVersion = (firstMapFilename != nil) ? max(version, 6) : version
        return (chunks, targetDuration, effectiveVersion, firstMapFilename, initSegmentURLs)
    }

    private func processNextChunks(for vodId: String) {
        guard var pending = pendingChunks[vodId] else { return }
        guard activeChunkTasks[vodId] != nil else { return }

        while activeChunkTasks[vodId]!.count < maxConcurrentChunksPerVOD, !pending.isEmpty {
            let nextChunk = pending.removeFirst()
            let task = urlSession.downloadTask(with: nextChunk.remoteURL)
            // Store vodId in taskDescription — a read-only property accessible from any thread,
            // eliminating the need to read the downloadTasks dict off the main thread.
            task.taskDescription = vodId
            downloadTasks[task.taskIdentifier] = vodId  // kept for progress tracking (main thread only)
            activeChunkTasks[vodId]?.append(task)
            task.resume()
            AppLogger.shared.log("Starting chunk download: \(nextChunk.filename) for VOD \(vodId)")
        }

        pendingChunks[vodId] = pending
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self,
                  let vodId = self.downloadTasks[downloadTask.taskIdentifier] else { return }

            if totalBytesExpectedToWrite > 0 {
                self.taskProgress[downloadTask.taskIdentifier] =
                    Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
            }

            var activeProgressSum: Double = 0
            if let activeTasks = self.activeChunkTasks[vodId] {
                for task in activeTasks {
                    activeProgressSum += self.taskProgress[task.taskIdentifier] ?? 0
                }
            }

            let completed = Double(self.completedChunksCount[vodId] ?? 0)
            let total = Double(self.expectedChunksCount[vodId] ?? 1)

            let progress = min((completed + activeProgressSum) / total, 0.99)
            
            let now = Date()
            let lastUpdate = self.lastProgressUpdate[vodId] ?? .distantPast
            let lastValue = self.lastProgressValue[vodId] ?? 0.0
            
            // Throttle: Update only if 0.5s passed OR progress increased by 1%
            if now.timeIntervalSince(lastUpdate) >= 0.5 || (progress - lastValue) >= 0.01 {
                self.activeDownloads[vodId] = progress
                self.lastProgressUpdate[vodId] = now
                self.lastProgressValue[vodId] = progress
                
                let actor = self.downloadActor
                Task {
                    await actor?.updateSwiftDataProgress(vodId: vodId, progress: progress, state: .downloading)
                }
            }
        }
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        // ⚠️ Apple requirement: the file at `location` MUST be moved before this method returns.
        // The system deletes it as soon as this delegate method exits.
        // We use taskDescription (set at task creation, read-only & thread-safe) to get vodId
        // without touching any shared mutable dictionary from a non-main thread.
        guard let vodId = downloadTask.taskDescription,
              let sourceURL = downloadTask.originalRequest?.url else { return }

        let filename = sourceURL.lastPathComponent
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let destinationURL = documentsPath
            .appendingPathComponent("downloads")
            .appendingPathComponent(vodId)
            .appendingPathComponent(filename)

        // Move the file synchronously on the URLSession delegate queue (before this method returns).
        do {
            if FileManager.default.fileExists(atPath: destinationURL.path) {
                try FileManager.default.removeItem(at: destinationURL)
            }
            try FileManager.default.moveItem(at: location, to: destinationURL)
            
            // SECURITY/DEBUG: Check if the file we just saved is actually an XML error page
            // (e.g. Cloudfront 403 Access Denied) instead of a valid video chunk.
            let fileHandle = try FileHandle(forReadingFrom: destinationURL)
            let headerData = fileHandle.readData(ofLength: 5)
            fileHandle.closeFile()
            if let headerStr = String(data: headerData, encoding: .utf8), headerStr.hasPrefix("<?xml") {
                AppLogger.shared.log("🚨 FATAL ERROR: Downloaded chunk \(filename) is an XML error page (AccessDenied?) - not a video file!")
                // You can also read the full error to see why it was denied:
                let fullError = try? String(contentsOf: destinationURL, encoding: .utf8)
                AppLogger.shared.log("🚨 Cloudfront Error: \(fullError ?? "Unknown")")
            }
        } catch {
            AppLogger.shared.log("Failed to move or validate chunk '\(filename)': \(error)")
            return
        }

        // All mutable state updates happen on the main thread.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }

            self.downloadTasks.removeValue(forKey: downloadTask.taskIdentifier)
            self.taskProgress.removeValue(forKey: downloadTask.taskIdentifier)

            self.completedChunksCount[vodId, default: 0] += 1
            if let idx = self.activeChunkTasks[vodId]?.firstIndex(of: downloadTask) {
                self.activeChunkTasks[vodId]?.remove(at: idx)
            }

            let completed = self.completedChunksCount[vodId] ?? 0
            let expected = self.expectedChunksCount[vodId] ?? 1
            let isDone = completed == expected && (self.pendingChunks[vodId]?.isEmpty ?? true)
                let _ = isDone ? 1.0 : Double(completed) / Double(expected)

            AppLogger.shared.log("Chunk done [\(completed)/\(expected)] for VOD \(vodId)")

            if isDone {
                self.remuxToMP4(vodId: vodId)
            } else {
                self.processNextChunks(for: vodId)
            }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return } // success is handled in didFinishDownloadingTo

        AppLogger.shared.log("Download task failed: \(error.localizedDescription)")

        // Use taskDescription (thread-safe) to retrieve vodId without a shared-dict race.
        guard let vodId = task.taskDescription else { return }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }

            self.downloadTasks.removeValue(forKey: task.taskIdentifier)
            self.taskProgress.removeValue(forKey: task.taskIdentifier)

            if let downloadTask = task as? URLSessionDownloadTask,
               let idx = self.activeChunkTasks[vodId]?.firstIndex(of: downloadTask) {
                self.activeChunkTasks[vodId]?.remove(at: idx)
            }

            // Stop all pending chunks and mark as failed.
            self.pendingChunks[vodId] = []
            self.activeDownloads.removeValue(forKey: vodId)

            if self.activeDownloads.isEmpty || self.activeDownloads.values.allSatisfy({ $0 >= 1.0 }) {
                UIApplication.shared.isIdleTimerDisabled = false
            }

            let actor = self.downloadActor
            Task {
                await actor?.setDownloadStateFailed(vodId: vodId)
            }
        }
    }

    /// Called when the app returns to foreground — restarts any interrupted chunk downloads.
    @MainActor
    func resumeActiveDownloads(modelContext: ModelContext) {
        if downloadActor == nil {
            downloadActor = DownloadModelActor(modelContainer: modelContext.container)
        }

        let descriptor = FetchDescriptor<VODDownload>(
            predicate: #Predicate { $0.stateRaw == "downloading" }
        )
        guard let interruptedDownloads = try? modelContext.fetch(descriptor),
              !interruptedDownloads.isEmpty else { return }

        for download in interruptedDownloads {
            let vodId = download.vodId

            // Skip if already being handled in memory.
            if let existing = activeChunkTasks[vodId], !existing.isEmpty { continue }
            if let pending = pendingChunks[vodId], !pending.isEmpty { continue }

            AppLogger.shared.log("Resuming interrupted download for VOD: \(vodId)")
            UIApplication.shared.isIdleTimerDisabled = true
            activeDownloads[vodId] = download.progress

            Task {
                do {
                    let playlistURL = try await TwitchHLSManager.shared.fetchPlaylistURL(
                        videoID: vodId,
                        isLive: false,
                        quality: download.quality
                    )
                    let (data, _) = try await URLSession.shared.data(from: playlistURL)
                    guard let playlistString = String(data: data, encoding: .utf8) else {
                        throw URLError(.badServerResponse)
                    }

                    let (chunks, _, _, firstMapFilename, initSegmentURLs) = parsePlaylist(
                        playlist: playlistString,
                        baseURL: playlistURL,
                        isSegment: download.isSegment,
                        startTime: download.startTime,
                        endTime: download.endTime
                    )

                    let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                    let vodDirectory = documentsPath
                        .appendingPathComponent("downloads")
                        .appendingPathComponent(vodId)

                    // Re-download any missing init segments.
                    for initURL in initSegmentURLs {
                        let localFilename = initURL.lastPathComponent
                        let destURL = vodDirectory.appendingPathComponent(localFilename)
                        if !FileManager.default.fileExists(atPath: destURL.path) {
                            AppLogger.shared.log("Re-downloading missing init segment: \(localFilename) for VOD \(vodId)")
                            let (initData, _) = try await URLSession.shared.data(from: initURL)
                            try initData.write(to: destURL)
                        }
                    }

                    let remainingChunks = chunks.filter { chunk in
                        let dest = vodDirectory.appendingPathComponent(chunk.filename)
                        return !FileManager.default.fileExists(atPath: dest.path)
                    }

                    await MainActor.run {
                        self.orderedChunks[vodId] = chunks
                        if let firstMap = firstMapFilename {
                            self.firstMapFilenames[vodId] = firstMap
                        }
                        self.expectedChunksCount[vodId] = chunks.count
                    }

                    guard !remainingChunks.isEmpty else {
                        // All chunks already on disk — run remux to create output files
                        // (index.m3u8 for fMP4, video.ts + duration + segments.json for TS).
                        await MainActor.run {
                            self.completedChunksCount[vodId] = chunks.count
                            self.remuxToMP4(vodId: vodId)
                        }
                        return
                    }

                    AppLogger.shared.log("Resuming \(remainingChunks.count) remaining chunks for VOD \(vodId)")

                    let alreadyDone = chunks.count - remainingChunks.count
                    await MainActor.run {
                        self.completedChunksCount[vodId] = alreadyDone
                        self.pendingChunks[vodId] = remainingChunks
                        self.activeChunkTasks[vodId] = []
                        self.processNextChunks(for: vodId)
                    }

                } catch {
                    AppLogger.shared.log("Failed to resume VOD download \(vodId): \(error)")
                }
            }
        }
    }

    func pauseDownload(vodId: String) {
        AppLogger.shared.log("Pausing download for \(vodId)")
        
        // Cancel active tasks if any.
        activeChunkTasks[vodId]?.forEach { $0.cancel() }
        
        // Remove from memory tracking.
        let progress = activeDownloads[vodId] ?? 0.0
        activeDownloads.removeValue(forKey: vodId)
        pendingChunks.removeValue(forKey: vodId)
        activeChunkTasks.removeValue(forKey: vodId)
        expectedChunksCount.removeValue(forKey: vodId)
        completedChunksCount.removeValue(forKey: vodId)
        lastProgressUpdate.removeValue(forKey: vodId)
        lastProgressValue.removeValue(forKey: vodId)
        
        // Keep the database entry, but set to paused.
        let actor = self.downloadActor
        Task {
            await actor?.updateSwiftDataProgress(vodId: vodId, progress: progress, state: .paused)
        }
        
        if activeDownloads.isEmpty || activeDownloads.values.allSatisfy({ $0 >= 1.0 }) {
            DispatchQueue.main.async {
                UIApplication.shared.isIdleTimerDisabled = false
            }
        }
    }
    
    private func cancelDownloadsIfOnCellularAndRestricted() {
        let preference = UserDefaults.standard.string(forKey: "downloadNetworkPreference") ?? "all"
        if preference == "wifi" {
            AppLogger.shared.log("Switched to cellular data with Wi-Fi only restriction. Pausing active downloads.")
            for vodId in activeDownloads.keys {
                pauseDownload(vodId: vodId)
            }
        }
    }

    func deleteDownload(vodId: String, modelContext: ModelContext) {
        // Cancel active tasks if any.
        activeChunkTasks[vodId]?.forEach { $0.cancel() }

        // Remove from memory tracking.
        activeDownloads.removeValue(forKey: vodId)
        pendingChunks.removeValue(forKey: vodId)
        activeChunkTasks.removeValue(forKey: vodId)
        expectedChunksCount.removeValue(forKey: vodId)
        completedChunksCount.removeValue(forKey: vodId)
        lastProgressUpdate.removeValue(forKey: vodId)
        lastProgressValue.removeValue(forKey: vodId)

        // Remove physical files.
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let vodDirectory = documentsPath
            .appendingPathComponent("downloads")
            .appendingPathComponent(vodId)

        if FileManager.default.fileExists(atPath: vodDirectory.path) {
            try? FileManager.default.removeItem(at: vodDirectory)
        }

        // Remove from SwiftData.
        if downloadActor == nil {
            downloadActor = DownloadModelActor(modelContainer: modelContext.container)
        }
        let actor = self.downloadActor
        Task {
            await actor?.deleteDownload(vodId: vodId)
        }

        if activeDownloads.isEmpty || activeDownloads.values.allSatisfy({ $0 >= 1.0 }) {
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }
    
    /// Copie le contenu de `source` dans `handle` par blocs de `chunkSize` octets.
    /// Évite de charger tout le fichier en mémoire d'un coup (crucial pour les chunks fMP4 ≥ 10 Mo).
    private func streamCopy(from source: URL, to handle: FileHandle, chunkSize: Int = 4 * 1024 * 1024) throws {
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        while true {
            let block = input.readData(ofLength: chunkSize)
            if block.isEmpty { break }
            try handle.write(contentsOf: block)
        }
    }

    private func remuxToMP4(vodId: String) {
        guard let chunks = orderedChunks[vodId], !chunks.isEmpty else {
            AppLogger.shared.log("❌ Remux aborted: no chunks recorded for VOD \(vodId)")
            Task { await setDownloadStateFailed(vodId: vodId) }
            return
        }

        let firstMap = firstMapFilenames[vodId]
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let vodDirectory = documentsPath.appendingPathComponent("downloads").appendingPathComponent(vodId)

        Task {
            do {
                let isFragmentedMP4 = (firstMap != nil)

                if isFragmentedMP4 {
                    // fMP4: keep all files, write an index.m3u8 with relative paths.
                    // AVPlayer loads it via TSPlayerKit's local HTTP server — no concatenation needed.

                    let playlistPath = "downloads/\(vodId)/index.m3u8"
                    let m3u8URL = vodDirectory.appendingPathComponent("index.m3u8")
                    try? FileManager.default.removeItem(at: vodDirectory.appendingPathComponent("video.mp4"))

                    var m3u8Lines: [String] = [
                        "#EXTM3U",
                        "#EXT-X-VERSION:6",  // fMP4/CMAF requires >= 6 for #EXT-X-MAP
                        "#EXT-X-TARGETDURATION:\(max(1, Int(ceil(chunks.map(\.duration).max() ?? 10.0))))",
                        "#EXT-X-MEDIA-SEQUENCE:0",
                    ]
                    if let mapFile = firstMap {
                        m3u8Lines.append("#EXT-X-MAP:URI=\"\(mapFile)\"")
                    }

                    var missingCount = 0
                    for chunk in chunks {
                        if let nextMap = chunk.nextMapFilename {
                            m3u8Lines.append("#EXT-X-MAP:URI=\"\(nextMap)\"")
                        }
                        for tag in chunk.trailingTags { m3u8Lines.append(tag) }
                        guard FileManager.default.fileExists(atPath: vodDirectory.appendingPathComponent(chunk.filename).path) else {
                            missingCount += 1; continue
                        }
                        m3u8Lines.append("#EXTINF:\(String(format: "%.3f", chunk.duration)),")
                        m3u8Lines.append(chunk.filename)
                    }

                    guard missingCount < chunks.count else {
                        AppLogger.shared.log("❌ fMP4: no valid chunks for VOD \(vodId)")
                        await setDownloadStateFailed(vodId: vodId); return
                    }

                    m3u8Lines.append("#EXT-X-ENDLIST")
                    try m3u8Lines.joined(separator: "\n").write(to: m3u8URL, atomically: true, encoding: .utf8)
                    AppLogger.shared.log("✅ fMP4 m3u8: \(chunks.count - missingCount)/\(chunks.count) chunks for VOD \(vodId)")

                    // Keep all chunk files — they are referenced by the m3u8.

                    await MainActor.run { self.activeDownloads[vodId] = 1.0 }
                    await downloadActor?.completeDownload(vodId: vodId, playlistPath: playlistPath)

                } else {
                    // TS: concatenate chunks into video.ts, write sidecar metadata.
                    let outputURL = vodDirectory.appendingPathComponent("video.ts")
                    let playlistPath = "downloads/\(vodId)/video.ts"
                    try? FileManager.default.removeItem(at: outputURL)

                    FileManager.default.createFile(atPath: outputURL.path, contents: nil)
                    let handle = try FileHandle(forWritingTo: outputURL)
                    defer { try? handle.close() }

                    var missingCount = 0
                    var currentOffset: UInt64 = 0
                    var segmentMetadatas: [[String: Any]] = []

                    for chunk in chunks {
                        let chunkURL = vodDirectory.appendingPathComponent(chunk.filename)
                        guard FileManager.default.fileExists(atPath: chunkURL.path) else {
                            missingCount += 1; continue
                        }
                        guard let attrs = try? FileManager.default.attributesOfItem(atPath: chunkURL.path),
                              let chunkSize = (attrs[.size] as? NSNumber)?.uint64Value else {
                            missingCount += 1; continue
                        }
                        try streamCopy(from: chunkURL, to: handle)
                        segmentMetadatas.append(["offset": currentOffset, "duration": chunk.duration, "length": chunkSize])
                        currentOffset += chunkSize
                    }

                    guard missingCount < chunks.count else {
                        AppLogger.shared.log("❌ TS remux aborted: no valid chunks for VOD \(vodId)")
                        try? handle.close(); try? FileManager.default.removeItem(at: outputURL)
                        await setDownloadStateFailed(vodId: vodId); return
                    }

                    try handle.close()
                    AppLogger.shared.log("✅ TS remux: \(chunks.count - missingCount)/\(chunks.count) chunks for VOD \(vodId)")

                    // Duration file (legacy fallback for single-segment manifest).
                    let totalDuration = chunks.reduce(0.0) { $0 + $1.duration }
                    try? String(totalDuration).write(to: vodDirectory.appendingPathComponent("video.duration"),
                                                      atomically: true, encoding: .utf8)

                    // Segment metadata (preferred multi-segment path).
                    if !segmentMetadatas.isEmpty,
                       let jsonData = try? JSONSerialization.data(withJSONObject: segmentMetadatas) {
                        try? jsonData.write(to: vodDirectory.appendingPathComponent("video.segments.json"))
                        AppLogger.shared.log("📝 video.segments.json: \(segmentMetadatas.count) segments, \(totalDuration)s")
                    }

                    // Cleanup individual chunks (concatenated into video.ts).
                    for chunk in chunks {
                        try? FileManager.default.removeItem(at: vodDirectory.appendingPathComponent(chunk.filename))
                    }
                    try? FileManager.default.removeItem(at: vodDirectory.appendingPathComponent("index.m3u8"))

                    await MainActor.run { self.activeDownloads[vodId] = 1.0 }
                    await downloadActor?.completeDownload(vodId: vodId, playlistPath: playlistPath)
                }

                await MainActor.run {
                    if self.activeDownloads.values.allSatisfy({ $0 >= 1.0 }) {
                        UIApplication.shared.isIdleTimerDisabled = false
                    }
                }

            } catch {
                AppLogger.shared.log("❌ Remux error: \(error.localizedDescription)")
                await setDownloadStateFailed(vodId: vodId)
            }
        }
    }
}

