import Foundation
import SwiftData
import Combine
import SwiftUI
import AVFoundation
import CoreMedia

class VODDownloadManager: NSObject, ObservableObject, URLSessionDownloadDelegate {
    static let shared = VODDownloadManager()

    @Published var activeDownloads: [String: Double] = [:]
    @Published var downloadSpeeds: [String: Double] = [:] // MB/s


    private var lastProgressUpdate: [String: Date] = [:]
    private var lastProgressValue: [String: Double] = [:]
    private var lastSpeedSample: [String: (bytes: Int64, time: Date)] = [:]
    private var taskLastBytes: [Int: Int64] = [:]
    private var vodCumulativeBytes: [String: Int64] = [:]
    private var downloadActor: DownloadModelActor?

    private var downloadTasks: [Int: String] = [:]


    private var pendingChunks: [String: [HLSPlaylistParser.ChunkInfo]] = [:]
    private var activeChunkTasks: [String: [URLSessionDownloadTask]] = [:]

    private var expectedChunksCount: [String: Int] = [:]
    private var completedChunksCount: [String: Int] = [:]
    private var orderedChunks: [String: [HLSPlaylistParser.ChunkInfo]] = [:]
    private var firstMapFilenames: [String: String] = [:]

    private let maxConcurrentChunksPerVOD = 4

    private var taskProgress: [Int: Double] = [:]
    
    private var cancellables = Set<AnyCancellable>()

    private lazy var urlSession: URLSession = {
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

                let parseResult = HLSPlaylistParser().parse(
                    playlist: playlistString,
                    baseURL: playlistURL,
                    isSegment: isSegment,
                    startTime: startTime,
                    endTime: endTime
                )
                let chunks = parseResult.chunks
                let firstMapFilename = parseResult.firstMapFilename
                let initSegmentURLs = parseResult.initSegmentURLs

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
                for initURL in initSegmentURLs {
                    let localFilename = initURL.lastPathComponent
                    let destURL = vodDirectory.appendingPathComponent(localFilename)
                    if !FileManager.default.fileExists(atPath: destURL.path) {
                        AppLogger.shared.log("Downloading init segment: \(localFilename) for VOD \(vodId)")
                        let (initData, _) = try await URLSession.shared.data(from: initURL)
                        try initData.write(to: destURL)
                    }
                }

                // Chunks will be processed in finalizeDownload once all downloads complete:
                // - fMP4 → local index.m3u8 (keeps all files)
                // - TS  → binary concat into video_NNN.ts files (max 3h each) + segments.json.
                
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


    // ChunkInfo and parsePlaylist are now in HLSPlaylistParser.swift

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

            let taskDelta: Int64
            if let previous = self.taskLastBytes[downloadTask.taskIdentifier] {
                taskDelta = max(0, totalBytesWritten - previous)
            } else {
                taskDelta = totalBytesWritten
            }
            self.taskLastBytes[downloadTask.taskIdentifier] = totalBytesWritten
            self.vodCumulativeBytes[vodId, default: 0] += taskDelta

            let now = Date()
            let vodTotal = self.vodCumulativeBytes[vodId] ?? 0
            if let last = self.lastSpeedSample[vodId] {
                let elapsed = now.timeIntervalSince(last.time)
                if elapsed >= 1.0 { // update every second
                    let bytesDelta = vodTotal - last.bytes
                    let mbPerSec = Double(bytesDelta) / elapsed / 1_048_576.0
                    self.downloadSpeeds[vodId] = max(0, mbPerSec)
                    self.lastSpeedSample[vodId] = (bytes: vodTotal, time: now)
                }
            } else {
                self.lastSpeedSample[vodId] = (bytes: vodTotal, time: now)
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
        guard let vodId = downloadTask.taskDescription,
              let sourceURL = downloadTask.originalRequest?.url else { return }

        let filename = sourceURL.lastPathComponent
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let destinationURL = documentsPath
            .appendingPathComponent("downloads")
            .appendingPathComponent(vodId)
            .appendingPathComponent(filename)

        do {
            if FileManager.default.fileExists(atPath: destinationURL.path) {
                try FileManager.default.removeItem(at: destinationURL)
            }
            try FileManager.default.moveItem(at: location, to: destinationURL)
            
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
            self.taskLastBytes.removeValue(forKey: downloadTask.taskIdentifier)

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
                self.finalizeDownload(vodId: vodId)
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
            self.taskLastBytes.removeValue(forKey: task.taskIdentifier)

            if let downloadTask = task as? URLSessionDownloadTask,
               let idx = self.activeChunkTasks[vodId]?.firstIndex(of: downloadTask) {
                self.activeChunkTasks[vodId]?.remove(at: idx)
            }

            // Stop all pending chunks and mark as failed.
            self.pendingChunks[vodId] = []
            self.activeDownloads.removeValue(forKey: vodId)
            self.downloadSpeeds.removeValue(forKey: vodId)
            self.lastSpeedSample.removeValue(forKey: vodId)
            self.vodCumulativeBytes.removeValue(forKey: vodId)

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

                    let parseResult = HLSPlaylistParser().parse(
                        playlist: playlistString,
                        baseURL: playlistURL,
                        isSegment: download.isSegment,
                        startTime: download.startTime,
                        endTime: download.endTime
                    )
                    let chunks = parseResult.chunks
                    let firstMapFilename = parseResult.firstMapFilename
                    let initSegmentURLs = parseResult.initSegmentURLs

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
                        // All chunks already on disk — run finalize to create output files
                        // (index.m3u8 for fMP4, video_NNN.ts + segments.json for TS).
                        await MainActor.run {
                            self.completedChunksCount[vodId] = chunks.count
                            self.finalizeDownload(vodId: vodId)
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

        // Clean up per-task tracking for all active chunk tasks of this VOD.
        if let tasks = activeChunkTasks[vodId] {
            for task in tasks {
                taskLastBytes.removeValue(forKey: task.taskIdentifier)
            }
        }
        activeChunkTasks[vodId]?.forEach { $0.cancel() }

        let progress = activeDownloads[vodId] ?? 0.0
        activeDownloads.removeValue(forKey: vodId)
        downloadSpeeds.removeValue(forKey: vodId)
        lastSpeedSample.removeValue(forKey: vodId)
        vodCumulativeBytes.removeValue(forKey: vodId)
        pendingChunks.removeValue(forKey: vodId)
        activeChunkTasks.removeValue(forKey: vodId)
        expectedChunksCount.removeValue(forKey: vodId)
        completedChunksCount.removeValue(forKey: vodId)
        lastProgressUpdate.removeValue(forKey: vodId)
        lastProgressValue.removeValue(forKey: vodId)
        
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
        // Clean up per-task tracking for all active chunk tasks of this VOD.
        if let tasks = activeChunkTasks[vodId] {
            for task in tasks {
                taskLastBytes.removeValue(forKey: task.taskIdentifier)
            }
        }
        activeChunkTasks[vodId]?.forEach { $0.cancel() }

        activeDownloads.removeValue(forKey: vodId)
        downloadSpeeds.removeValue(forKey: vodId)
        lastSpeedSample.removeValue(forKey: vodId)
        vodCumulativeBytes.removeValue(forKey: vodId)
        pendingChunks.removeValue(forKey: vodId)
        activeChunkTasks.removeValue(forKey: vodId)
        expectedChunksCount.removeValue(forKey: vodId)
        completedChunksCount.removeValue(forKey: vodId)
        lastProgressUpdate.removeValue(forKey: vodId)
        lastProgressValue.removeValue(forKey: vodId)

        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let vodDirectory = documentsPath
            .appendingPathComponent("downloads")
            .appendingPathComponent(vodId)

        if FileManager.default.fileExists(atPath: vodDirectory.path) {
            try? FileManager.default.removeItem(at: vodDirectory)
        }

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
    /// Chaque itération est wrappée dans `autoreleasepool` pour que les objets `Data`
    /// autoreleasés retournés par `readData(ofLength:)` soient libérés immédiatement
    /// au lieu de s'accumuler jusqu'à la fin du runloop — sans cela, concaténer
    /// plusieurs Go de chunks TS déclenche un jetsam (crash mémoire).
    private func streamCopy(from source: URL, to handle: FileHandle, chunkSize: Int = 4 * 1024 * 1024) throws {
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        while true {
            let done = try autoreleasepool { () -> Bool in
                let block = input.readData(ofLength: chunkSize)
                if block.isEmpty { return true }
                try handle.write(contentsOf: block)
                return false
            }
            if done { break }
        }
    }

    private func finalizeDownload(vodId: String) {
        guard let chunks = orderedChunks[vodId], !chunks.isEmpty else {
            AppLogger.shared.log("❌ Finalize aborted: no chunks recorded for VOD \(vodId)")
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

                    let totalDuration = chunks.reduce(0.0) { $0 + $1.duration }
                    await MainActor.run { self.activeDownloads[vodId] = 1.0 }
                    await downloadActor?.completeDownload(vodId: vodId, playlistPath: playlistPath, durationSeconds: totalDuration)

                } else {
                    // TS: concatenate chunks into video_NNN.ts files (max 3h each).
                    // Each file gets its own offset range in segments.json.
                    try? FileManager.default.removeItem(at: vodDirectory.appendingPathComponent("video.ts"))
                    try? FileManager.default.removeItem(at: vodDirectory.appendingPathComponent("video.mp4"))
                    try? FileManager.default.removeItem(at: vodDirectory.appendingPathComponent("video.duration"))

                    let maxDurationPerFile: Double = 10_800 // 3 hours

                    var fileIndex = 0
                    var batchChunks: [HLSPlaylistParser.ChunkInfo] = []
                    var batchDuration: Double = 0
                    var allSegmentMetadatas: [[String: Any]] = []
                    var missingCount = 0

                    /// Finalizes the current batch: writes the TS file and records segment metadata.
                    /// Each chunk copy is wrapped in `autoreleasepool` so that filesystem API
                    /// objects (NSDictionary from attributesOfItem, etc.) are drained immediately
                    /// rather than accumulating across hundreds of chunks.
                    func flushBatch() throws {
                        guard !batchChunks.isEmpty else { return }
                        let filename = String(format: "video_%03d.ts", fileIndex)
                        let outputURL = vodDirectory.appendingPathComponent(filename)
                        FileManager.default.createFile(atPath: outputURL.path, contents: nil)
                        let handle = try FileHandle(forWritingTo: outputURL)
                        defer { try? handle.close() }

                        var currentOffset: UInt64 = 0
                        for chunk in batchChunks {
                            try autoreleasepool {
                                let chunkURL = vodDirectory.appendingPathComponent(chunk.filename)
                                guard FileManager.default.fileExists(atPath: chunkURL.path),
                                      let attrs = try? FileManager.default.attributesOfItem(atPath: chunkURL.path),
                                      let chunkSize = (attrs[.size] as? NSNumber)?.uint64Value else {
                                    missingCount += 1; return
                                }
                                try streamCopy(from: chunkURL, to: handle)
                                allSegmentMetadatas.append([
                                    "file": filename,
                                    "offset": currentOffset,
                                    "duration": chunk.duration,
                                    "length": chunkSize,
                                ])
                                currentOffset += chunkSize
                            }
                        }

                        AppLogger.shared.log("📦 Wrote \(filename): \(batchChunks.count) chunks, \(String(format: "%.1f", batchDuration))s")
                        batchChunks = []
                        batchDuration = 0
                        fileIndex += 1
                    }

                    for chunk in chunks {
                        // If adding this chunk would exceed the limit AND we already have chunks,
                        // flush the current batch first.
                        if !batchChunks.isEmpty, batchDuration + chunk.duration > maxDurationPerFile {
                            try flushBatch()
                        }
                        batchChunks.append(chunk)
                        batchDuration += chunk.duration
                    }
                    // Flush the last batch.
                    try flushBatch()

                    guard missingCount < chunks.count else {
                        AppLogger.shared.log("❌ TS finalize aborted: no valid chunks for VOD \(vodId)")
                        // Clean up any partial output files.
                        for i in 0..<fileIndex {
                            try? FileManager.default.removeItem(at: vodDirectory.appendingPathComponent(
                                String(format: "video_%03d.ts", i)))
                        }
                        await setDownloadStateFailed(vodId: vodId); return
                    }

                    let totalDuration = chunks.reduce(0.0) { $0 + $1.duration }
                    AppLogger.shared.log("✅ TS finalize: \(chunks.count - missingCount)/\(chunks.count) chunks → \(fileIndex) file(s), \(totalDuration)s total, VOD \(vodId)")

                    if !allSegmentMetadatas.isEmpty,
                       let jsonData = try? JSONSerialization.data(withJSONObject: allSegmentMetadatas) {
                        try? jsonData.write(to: vodDirectory.appendingPathComponent("video.segments.json"))
                        AppLogger.shared.log("📝 video.segments.json: \(allSegmentMetadatas.count) segments across \(fileIndex) file(s)")
                    }

                    for chunk in chunks {
                        try? FileManager.default.removeItem(at: vodDirectory.appendingPathComponent(chunk.filename))
                    }
                    try? FileManager.default.removeItem(at: vodDirectory.appendingPathComponent("index.m3u8"))

                    let playlistPath = "downloads/\(vodId)/video_000.ts"
                    await MainActor.run { self.activeDownloads[vodId] = 1.0 }
                    await downloadActor?.completeDownload(vodId: vodId, playlistPath: playlistPath, durationSeconds: totalDuration)
                }

                await MainActor.run {
                    self.downloadSpeeds.removeValue(forKey: vodId)
                    self.lastSpeedSample.removeValue(forKey: vodId)
                    self.vodCumulativeBytes.removeValue(forKey: vodId)
                    if self.activeDownloads.values.allSatisfy({ $0 >= 1.0 }) {
                        UIApplication.shared.isIdleTimerDisabled = false
                    }
                }

            } catch {
                AppLogger.shared.log("❌ Finalize error: \(error.localizedDescription)")
                await MainActor.run {
                    self.downloadSpeeds.removeValue(forKey: vodId)
                    self.lastSpeedSample.removeValue(forKey: vodId)
                    self.vodCumulativeBytes.removeValue(forKey: vodId)
                }
                await setDownloadStateFailed(vodId: vodId)
            }
        }
    }
}

