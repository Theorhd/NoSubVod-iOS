import Foundation

enum TwitchHLSError: Error {
    case failedToFetchToken
    case invalidPlaylistURL
    case parsingError
    case missingSeekPreviewsURL
}

final class TwitchHLSManager {
    static let shared = TwitchHLSManager()
    
    private init() {}
    
    func fetchPlaylistURL(videoID: String, isLive: Bool, quality: String? = nil, ttvProxyURL: String? = nil) async throws -> URL {
        if isLive {
            return try await fetchLivePlaylistURL(videoID: videoID, quality: quality, ttvProxyURL: ttvProxyURL)
        } else {
            return try await fetchVODPlaylistURL(videoID: videoID, quality: quality)
        }
    }

    private func fetchLivePlaylistURL(videoID: String, quality: String? = nil, ttvProxyURL: String? = nil) async throws -> URL {
        let query = """
        query PlaybackAccessToken_Template($login: String!) {
          streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) {
            value
            signature
          }
        }
        """
        
        let variables = ["login": videoID]
        
        guard let url = URL(string: "https://gql.twitch.tv/gql") else {
            throw TwitchHLSError.invalidPlaylistURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        // Timeout court : un réseau dégradé doit échouer vite et laisser le
        // player afficher une erreur, pas geler l'app 60 s (défaut).
        request.timeoutInterval = 20
        // Lecture (GQL) : web client ID Twitch, inchangé.
        request.addValue(TwitchAPIService.shared.webClientId, forHTTPHeaderField: "Client-Id")
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = ["query": query, "variables": variables]
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            AppLogger.shared.log("TwitchHLSManager: failed to serialize GQL body — \(error)")
        }
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw TwitchHLSError.failedToFetchToken
        }
        
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataDict = json["data"] as? [String: Any],
              let tokenDict = dataDict["streamPlaybackAccessToken"] as? [String: Any],
              let token = tokenDict["value"] as? String,
              let sig = tokenDict["signature"] as? String else {
            throw TwitchHLSError.failedToFetchToken
        }
        
        guard let safeToken = token.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_.~"))),
              let safeSig = sig.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_.~"))) else {
            throw TwitchHLSError.failedToFetchToken
        }
        
        let p = Int.random(in: 1...999999)
        // The TTV proxy URL is user-configurable: normalize it (scheme, host,
        // optional path prefix) or fall back to the real usher endpoint.
        let usherBase = TwitchHLSManager.normalizeTTVProxyURL(ttvProxyURL) ?? "https://usher.ttvnw.net"
        let masterUrlStr = "\(usherBase)/api/channel/hls/\(videoID).m3u8?client_id=\(TwitchAPIService.shared.webClientId)&token=\(safeToken)&sig=\(safeSig)&allow_source=true&allow_audio_only=true&fast_bread=true&player_backend=mediaplayer&playlist_include_framerate=true&player=twitchweb&p=\(p)"
        
        guard let masterUrl = URL(string: masterUrlStr) else {
            throw TwitchHLSError.invalidPlaylistURL
        }
        
        let targetQuality = quality ?? "auto"

        // When using a TTV proxy, always return the master URL. The proxy rewrites
        // every variant URL to point back to itself — extracting a variant URL from
        // the proxied master and playing it directly risks bypassing the proxy if
        // the URL happens to be absolute to the CDN. Let AVPlayer negotiate quality;
        // the proxy strips ads regardless of which variant AVPlayer picks.
        if ttvProxyURL != nil || targetQuality == "auto" {
            return masterUrl
        }

        let mappedQuality = TwitchHLSManager.mapQualityToTwitch(targetQuality)

        do {
            // Timeout court (20 s) pour le master usher : sur réseau dégradé,
            // on retombe sur auto au lieu de geler le lancement du live.
            var masterRequest = URLRequest(url: masterUrl)
            masterRequest.timeoutInterval = 20
            let (masterData, _) = try await URLSession.shared.data(for: masterRequest)
            if let masterString = String(data: masterData, encoding: .utf8) {
                let lines = masterString.components(separatedBy: .newlines)
                var pendingVariantURL = false
                for line in lines {
                    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)

                    // #EXT-X-STREAM-INF is followed by a variant URL on the next line.
                    if trimmed.hasPrefix("#EXT-X-STREAM-INF:") {
                        pendingVariantURL = trimmed.contains("VIDEO=\"\(mappedQuality)\"")
                                         || trimmed.contains("GROUP-ID=\"\(mappedQuality)\"")
                        continue
                    }

                    // #EXT-X-MEDIA (e.g. audio-only) carries its URI in-band.
                    // Do NOT set pendingVariantURL — there is no following URL line.
                    if trimmed.hasPrefix("#EXT-X-MEDIA:"),
                       trimmed.contains("GROUP-ID=\"\(mappedQuality)\"") {
                        if let start = trimmed.range(of: "URI=\"")?.upperBound,
                           let end = trimmed[start...].range(of: "\"")?.lowerBound {
                            let uri = String(trimmed[start..<end])
                            if let variantUrl = URL(string: uri) {
                                return variantUrl
                            }
                        }
                        continue
                    }

                    // URL line following a matched #EXT-X-STREAM-INF.
                    if pendingVariantURL, !trimmed.hasPrefix("#"), !trimmed.isEmpty {
                        if let variantUrl = URL(string: trimmed) {
                            return variantUrl
                        }
                    }
                    pendingVariantURL = false
                }
            }
        } catch {
            AppLogger.shared.log("Failed to parse live master playlist for specific quality, falling back to auto.")
        }

        return masterUrl
    }
    
    static func mapQualityToTwitch(_ quality: String) -> String {
        switch quality {
        case "auto": return "auto"
        case "1080p": return "chunked"
        case "720p": return "720p60"
        case "480p": return "480p30"
        case "360p": return "360p30"
        case "160p": return "160p30"
        case "Audio Only": return "audio_only"
        default: return quality
        }
    }

    /// Normalizes the user-configured TTV proxy base URL.
    ///
    /// Accepts values with or without a scheme ("api.ttv.lol",
    /// "https://api.ttv.lol/", "https://my-proxy.example.com/ttv") and returns a
    /// clean base URL (scheme + host + optional path prefix, no query/fragment,
    /// no trailing slash). Returns `nil` for empty or malformed input — callers
    /// then use the real usher endpoint.
    static func normalizeTTVProxyURL(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        // Without a scheme, URL parsing treats the host as a path and the
        // resulting master URL is unusable — add one.
        let withScheme = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard let url = URL(string: withScheme),
              let host = url.host, !host.isEmpty else { return nil }

        // Preserve scheme, host, AND path prefix so that custom proxy
        // deployments (e.g. https://my-proxy.example.com/ttv) work.
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.query = nil
        components?.fragment = nil
        guard var base = components?.string, !base.isEmpty else { return nil }
        while base.hasSuffix("/") { base.removeLast() }
        return base
    }
    
    private func fetchVODPlaylistURL(videoID: String, quality: String? = nil) async throws -> URL {
        // We use the direct Cloudfront inference approach (bypassing usher) to avoid 403 Forbidden
        let query = """
        query {
            video(id: "\(videoID)") {
                seekPreviewsURL
                broadcastType
            }
        }
        """
        
        let data = try await TwitchAPIService.shared.executeGQLQuery(query: query, variables: [:])
        
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataDict = json["data"] as? [String: Any],
              let videoDict = dataDict["video"] as? [String: Any],
              let seekPreviewsURL = videoDict["seekPreviewsURL"] as? String else {
            throw TwitchHLSError.missingSeekPreviewsURL
        }
        
        let broadcastType = videoDict["broadcastType"] as? String ?? "ARCHIVE"
        
        guard let previewsURL = URL(string: seekPreviewsURL),
              let host = previewsURL.host else {
            throw TwitchHLSError.parsingError
        }
        
        let pathComponents = previewsURL.pathComponents
        guard pathComponents.count >= 3 else {
            throw TwitchHLSError.parsingError
        }
        
        let specialID = pathComponents[1] // e.g. 3257ff9e4bf8f6b8b082_lestream_41617416395_1603986259
        
        let filename: String
        if broadcastType == "HIGHLIGHT" {
            filename = "highlight-\(videoID).m3u8"
        } else if broadcastType == "UPLOAD" {
            filename = "upload-\(videoID).m3u8"
        } else {
            filename = "index-dvr.m3u8"
        }
        
        var urlQuality = TwitchHLSManager.mapQualityToTwitch(quality ?? "auto")
        if urlQuality == "auto" {
            // Direct Cloudfront inference bypasses Usher, so the master playlist (auto) is unavailable.
            // Fallback to highest quality.
            urlQuality = "chunked"
        }
        
        let chunkedURL = "https://\(host)/\(specialID)/\(urlQuality)/\(filename)"
        
        guard let url = URL(string: chunkedURL) else {
            throw TwitchHLSError.invalidPlaylistURL
        }
        
        return url
    }
}
