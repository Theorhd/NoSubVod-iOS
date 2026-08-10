import Foundation

/// Handles concatenation of downloaded TS chunks into video files.
enum DownloadFileMerger {

    /// Copies the contents of `source` into `handle` in blocks of `chunkSize` bytes.
    /// Each iteration is wrapped in `autoreleasepool` so that `Data` objects returned
    /// by `readData(ofLength:)` are freed immediately instead of accumulating until
    /// the runloop drains — without this, concatenating several GB of TS chunks
    /// triggers a memory crash (jetsam).
    static func streamCopy(from source: URL, to handle: FileHandle, chunkSize: Int = 4 * 1_024 * 1_024) throws {
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

    /// Concatenates batches of TS chunks into `video_NNN.ts` files (max `maxDurationPerFile` seconds each).
    /// Returns segment metadata for each chunk (file, offset, duration, length) to be written as segments.json.
    /// - Parameters:
    ///   - chunks: Ordered list of chunk metadata.
    ///   - vodDirectory: Directory containing the downloaded chunk files.
    ///   - maxDurationPerFile: Maximum total duration per output TS file (default: 3 hours).
    /// - Returns: A tuple of (segmentMetadatas, missingCount) — metadata is ready for JSON serialization.
    static func mergeChunks(
        chunks: [HLSPlaylistParser.ChunkInfo],
        vodDirectory: URL,
        maxDurationPerFile: Double = 10_800
    ) throws -> (segmentMetadatas: [[String: Any]], missingCount: Int) {
        var fileIndex = 0
        var batchChunks: [HLSPlaylistParser.ChunkInfo] = []
        var batchDuration: Double = 0
        var allSegmentMetadatas: [[String: Any]] = []
        var missingCount = 0

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
            if !batchChunks.isEmpty, batchDuration + chunk.duration > maxDurationPerFile {
                try flushBatch()
            }
            batchChunks.append(chunk)
            batchDuration += chunk.duration
        }
        try flushBatch()

        return (allSegmentMetadatas, missingCount)
    }
}
