import Foundation

enum TwitchHLSError: Error {
    case failedToFetchToken
    case invalidPlaylistURL
    case parsingError
    case missingSeekPreviewsURL
}

class TwitchHLSManager {
    static let shared = TwitchHLSManager()
    
    private init() {}
    
    func fetchPlaylistURL(videoID: String, isLive: Bool) async throws -> URL {
        if isLive {
            return try await fetchLivePlaylistURL(videoID: videoID)
        } else {
            return try await fetchVODPlaylistURL(videoID: videoID)
        }
    }
    
    private func fetchLivePlaylistURL(videoID: String) async throws -> URL {
        let query = """
        query PlaybackAccessToken_Template($login: String!) {
          streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) {
            value
            signature
          }
        }
        """
        
        let data = try await TwitchAPIService.shared.executeGQLQuery(query: query, variables: ["login": videoID])
        
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataDict = json["data"] as? [String: Any],
              let tokenDict = dataDict["streamPlaybackAccessToken"] as? [String: Any],
              let token = tokenDict["value"] as? String,
              let sig = tokenDict["signature"] as? String else {
            throw TwitchHLSError.failedToFetchToken
        }
        
        let allowedCharSet = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_.~"))
        let safeToken = token.addingPercentEncoding(withAllowedCharacters: allowedCharSet) ?? token
        let safeSig = sig.addingPercentEncoding(withAllowedCharacters: allowedCharSet) ?? sig
        
        let p = Int.random(in: 1...999999)
        let urlString = "https://usher.ttvnw.net/api/channel/hls/\(videoID).m3u8?client_id=\(TwitchAPIService.shared.clientId)&token=\(safeToken)&sig=\(safeSig)&allow_source=true&allow_audio_only=true&fast_bread=true&player_backend=mediaplayer&playlist_include_framerate=true&player=twitchweb&p=\(p)"
        
        guard let url = URL(string: urlString) else {
            throw TwitchHLSError.invalidPlaylistURL
        }
        return url
    }
    
    private func fetchVODPlaylistURL(videoID: String) async throws -> URL {
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
        
        let chunkedURL = "https://\(host)/\(specialID)/chunked/\(filename)"
        
        guard let url = URL(string: chunkedURL) else {
            throw TwitchHLSError.invalidPlaylistURL
        }
        
        return url
    }
}
