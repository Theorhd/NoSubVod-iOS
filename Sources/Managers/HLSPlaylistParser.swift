import Foundation

/// Parser dédié pour les playlists HLS Twitch.
struct HLSPlaylistParser {

    struct ChunkInfo {
        let remoteURL: URL
        let duration: Double
        let filename: String
        /// Filename of the next #EXT-X-MAP init segment that follows this chunk (mid-playlist MAP change)
        var nextMapFilename: String? = nil
        /// Mid-playlist HLS tags (e.g. #EXT-X-DISCONTINUITY) that appear after this chunk
        var trailingTags: [String] = []
    }

    struct ParseResult {
        let chunks: [ChunkInfo]
        let targetDuration: Int
        let version: Int
        let firstMapFilename: String?
        let initSegmentURLs: [URL]
    }

    /// Parse la playlist HLS Twitch et extrait les chunks à télécharger.
    /// Retourne uniquement les données nécessaires pour construire un header local propre —
    /// on ne copie JAMAIS le header Twitch brut car il contient des URLs HTTPS (PREFETCH tags, etc.)
    /// qu'AVPlayer tenterait de résoudre réseau au lieu d'utiliser les fichiers locaux.
    func parse(
        playlist: String,
        baseURL: URL,
        isSegment: Bool,
        startTime: Int?,
        endTime: Int?
    ) -> ParseResult {
        var chunks: [ChunkInfo] = []
        let lines = playlist.components(separatedBy: .newlines)

        var targetDuration: Int = 10
        var version: Int = 3
        var firstMapFilename: String? = nil
        var initSegmentURLs: [URL] = []
        var seenInitURIs: Set<String> = []

        var currentDuration: Double?
        var totalTime: Double = 0

        let start = Double(startTime ?? 0)
        let end = Double(endTime ?? Int.max)

        var inHeader = true
        var pendingNextMapFilename: String? = nil

        for line in lines {
            let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmedLine.isEmpty { continue }

            if trimmedLine.hasPrefix("#EXT-X-ENDLIST") {
                continue
            }

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

            if trimmedLine.hasPrefix("#") {
                if !chunks.isEmpty {
                    chunks[chunks.count - 1].trailingTags.append(trimmedLine)
                }
                continue
            }

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
        return ParseResult(
            chunks: chunks,
            targetDuration: targetDuration,
            version: effectiveVersion,
            firstMapFilename: firstMapFilename,
            initSegmentURLs: initSegmentURLs
        )
    }
}
