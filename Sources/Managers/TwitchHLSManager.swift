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
        request.addValue(TwitchAPIService.shared.clientId, forHTTPHeaderField: "Client-Id")
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = ["query": query, "variables": variables]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
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
        let usherHost = ttvProxyURL.flatMap { URL(string: $0)?.host } ?? "usher.ttvnw.net"
        let masterUrlStr = "https://\(usherHost)/api/channel/hls/\(videoID).m3u8?client_id=\(TwitchAPIService.shared.clientId)&token=\(safeToken)&sig=\(safeSig)&allow_source=true&allow_audio_only=true&fast_bread=true&player_backend=mediaplayer&playlist_include_framerate=true&player=twitchweb&p=\(p)"
        
        guard let masterUrl = URL(string: masterUrlStr) else {
            throw TwitchHLSError.invalidPlaylistURL
        }
        
        let targetQuality = quality ?? "auto"
        if targetQuality == "auto" {
            return masterUrl
        }
        
        let mappedQuality = TwitchHLSManager.mapQualityToTwitch(targetQuality)
        
        do {
            let (masterData, _) = try await URLSession.shared.data(from: masterUrl)
            if let masterString = String(data: masterData, encoding: .utf8) {
                let lines = masterString.components(separatedBy: .newlines)
                var foundQuality = false
                for line in lines {
                    if line.contains("GROUP-ID=\"\(mappedQuality)\"") || line.contains("VIDEO=\"\(mappedQuality)\"") {
                        foundQuality = true
                        continue
                    }
                    
                    if foundQuality && !line.hasPrefix("#") && !line.isEmpty {
                        if let variantUrl = URL(string: line) {
                            return variantUrl
                        }
                    }
                }
            }
        } catch {
            print("Failed to parse live master playlist for specific quality, falling back to auto.")
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
