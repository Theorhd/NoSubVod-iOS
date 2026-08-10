import Foundation

/// Generates local HLS playlists and segment metadata for downloaded content.
enum DownloadPlaylistBuilder {

    // MARK: - fMP4 / CMAF

    /// Writes an `index.m3u8` playlist referencing the downloaded fMP4 chunks in-place.
    /// No concatenation is needed — AVPlayer loads the files via TSPlayerKit's local HTTP server.
    /// - Returns: The playlist path relative to the Documents directory, or nil on failure.
    static func writeFMP4Playlist(
        chunks: [HLSPlaylistParser.ChunkInfo],
        firstMapFilename: String?,
        vodDirectory: URL,
        vodId: String
    ) throws -> (playlistPath: String, totalDuration: Double) {
        let m3u8URL = vodDirectory.appendingPathComponent("index.m3u8")

        var m3u8Lines: [String] = [
            "#EXTM3U",
            "#EXT-X-VERSION:6",
            "#EXT-X-TARGETDURATION:\(max(1, Int(ceil(chunks.map(\.duration).max() ?? 10.0))))",
            "#EXT-X-MEDIA-SEQUENCE:0",
        ]
        if let mapFile = firstMapFilename {
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
            throw PlaylistError.noValidChunks(vodId: vodId)
        }

        m3u8Lines.append("#EXT-X-ENDLIST")
        try m3u8Lines.joined(separator: "\n").write(to: m3u8URL, atomically: true, encoding: .utf8)

        let totalDuration = chunks.reduce(0.0) { $0 + $1.duration }
        let playlistPath = "downloads/\(vodId)/index.m3u8"
        AppLogger.shared.log("✅ fMP4 m3u8: \(chunks.count - missingCount)/\(chunks.count) chunks for VOD \(vodId)")

        return (playlistPath, totalDuration)
    }

    // MARK: - TS (concatenated)

    /// Writes a `video.segments.json` metadata file describing the byte-range layout
    /// of the concatenated TS files produced by `DownloadFileMerger.mergeChunks`.
    static func writeSegmentMetadata(
        segmentMetadatas: [[String: Any]],
        vodDirectory: URL
    ) {
        guard !segmentMetadatas.isEmpty,
              let jsonData = try? JSONSerialization.data(withJSONObject: segmentMetadatas) else { return }
        try? jsonData.write(to: vodDirectory.appendingPathComponent("video.segments.json"))
        AppLogger.shared.log("📝 video.segments.json: \(segmentMetadatas.count) segments")
    }

    /// Cleans up the individual chunk files after TS concatenation,
    /// as they are no longer needed (their content has been merged).
    static func cleanupChunkFiles(chunks: [HLSPlaylistParser.ChunkInfo], vodDirectory: URL) {
        for chunk in chunks {
            try? FileManager.default.removeItem(at: vodDirectory.appendingPathComponent(chunk.filename))
        }
        try? FileManager.default.removeItem(at: vodDirectory.appendingPathComponent("index.m3u8"))
    }

    // MARK: - Error

    enum PlaylistError: Error, LocalizedError {
        case noValidChunks(vodId: String)

        var errorDescription: String? {
            switch self {
            case let .noValidChunks(vodId):
                return "No valid chunks found on disk for VOD \(vodId)."
            }
        }
    }
}
