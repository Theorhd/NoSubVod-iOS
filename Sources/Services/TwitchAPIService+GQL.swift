import Foundation



private struct GQLResponse: Codable {
    let data: GQLData?
}

private struct GQLData: Codable {
    let streams: GQLStreams?
    let game: GQLGameSearch?
    let searchFor: GQLSearchFor?
    let videos: GQLVideos?
    let user: GQLUserNode?
    let video: GQLVideoNode?
}

private struct GQLStreams: Codable {
    let edges: [GQLEdge]?
}

private struct GQLEdge: Codable {
    let node: GQLLiveNode?
}

private struct GQLLiveNode: Codable {
    let id: String
    let title: String?
    let viewersCount: Int?
    let previewImageURL: String?
    let createdAt: String?
    let language: String?
    let game: GQLGameNode?
    let broadcaster: GQLBroadcasterNode?
}

private struct GQLGameNode: Codable {
    let id: String
    let name: String
    let boxArtURL: String?
}

private struct GQLBroadcasterNode: Codable {
    let id: String
    let login: String
    let displayName: String
    let profileImageURL: String?
}


private struct GQLGameSearch: Codable {
    let id: String?
    let name: String?
    let boxArtURL: String?
    let streams: GQLStreams?
    let videos: GQLVideos?
    let clips: GQLClips?
}
private struct GQLSearchFor: Codable {
    let channels: GQLSearchChannels?
}
private struct GQLSearchChannels: Codable {
    let edges: [GQLSearchResult]?
}
private struct GQLSearchResult: Codable {
    let item: GQLSearchItem?
}
private struct GQLSearchItem: Codable {
    let id: String?
    let login: String?
    let displayName: String?
    let profileImageURL: String?
    let stream: GQLLiveNode?
}


private struct GQLClips: Codable {
    let edges: [GQLClipEdge]?
}
private struct GQLClipEdge: Codable {
    let node: GQLClipNode?
}
private struct GQLClipNode: Codable {
    let id: String
    let title: String?
    let durationSeconds: Int?
    let thumbnailURL: String?
    let createdAt: String?
    let viewCount: Int?
    let broadcaster: GQLBroadcasterNode?
    let game: GQLGameNode?
}


private struct GQLVideos: Codable {
    let edges: [GQLVideoEdge]?
}
private struct GQLVideoEdge: Codable {
    let node: GQLVideoNode?
}
private struct GQLVideoNode: Codable {
    let id: String
    let title: String?
    let lengthSeconds: Int?
    let previewThumbnailURL: String?
    let createdAt: String?
    let viewCount: Int?
    let broadcastType: String?
    let game: GQLGameNode?
    let owner: GQLBroadcasterNode?
}

private struct GQLUserNode: Codable {
    let videos: GQLVideos?
}


extension TwitchAPIService {
    
    private static let fractionalDateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    
    private static let standardDateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
    
    /// Parse ISO8601 date strings (with or without fractional seconds).
    /// Made internal for testability.
    func parseDate(_ dateStr: String?) -> Date {
        guard let d = dateStr else { return Date() }
        if let date = Self.fractionalDateFormatter.date(from: d) { return date }
        if let date = Self.standardDateFormatter.date(from: d) { return date }
        return Date()
    }
    
    private func mapLiveNode(_ node: GQLLiveNode, fallbackGame: String? = nil) -> LiveStream {
        let broadcaster = LiveStreamBroadcaster(
            id: node.broadcaster?.id ?? "",
            login: node.broadcaster?.login ?? "",
            displayName: node.broadcaster?.displayName ?? "",
            profileImageURL: URL(string: node.broadcaster?.profileImageURL ?? "")
        )
        let game = Game(
            id: node.game?.id ?? "0",
            name: node.game?.name ?? fallbackGame ?? "Unknown",
            boxArtURL: URL(string: node.game?.boxArtURL ?? "")
        )
        return LiveStream(
            id: node.id,
            title: node.title ?? "",
            previewImageURL: URL(string: node.previewImageURL ?? ""),
            viewerCount: node.viewersCount ?? 0,
            language: node.language,
            startedAt: parseDate(node.createdAt),
            broadcaster: broadcaster,
            game: game
        )
    }
    
    private func mapVideoNode(_ node: GQLVideoNode) -> VOD {
        let owner = VODOwner(
            login: node.owner?.login ?? "",
            displayName: node.owner?.displayName ?? "",
            profileImageURL: URL(string: node.owner?.profileImageURL ?? "")
        )
        let game = Game(
            id: node.game?.id ?? "0",
            name: node.game?.name ?? "Unknown",
            boxArtURL: URL(string: node.game?.boxArtURL ?? "")
        )
        return VOD(
            id: node.id,
            title: node.title ?? "",
            lengthSeconds: node.lengthSeconds ?? 0,
            previewThumbnailURL: URL(string: node.previewThumbnailURL ?? ""),
            createdAt: parseDate(node.createdAt),
            viewCount: node.viewCount ?? 0,
            language: "en",
            broadcastType: node.broadcastType ?? "archive",
            game: game,
            owner: owner
        )
    }
    
    func fetchLiveStreams(limit: Int = 24) async throws -> [LiveStream] {
        let query = """
        query {
            streams(first: \(limit)) {
                edges {
                    node {
                        id title viewersCount previewImageURL(width: 640, height: 360) createdAt language
                        game { id name boxArtURL(width: 110, height: 147) }
                        broadcaster { id login displayName profileImageURL(width: 70) }
                    }
                }
            }
        }
        """
        
        let data = try await executeGQLQuery(query: query, variables: [:])
        let response = try await Task.detached { try JSONDecoder().decode(GQLResponse.self, from: data) }.value
        return response.data?.streams?.edges?.compactMap { edge in
            guard let node = edge.node else { return nil }
            return mapLiveNode(node)
        } ?? []
    }
    
    func globalSearch(query: String, limit: Int = 24) async throws -> GlobalSearchResult {
        let safeQuery = query.replacingOccurrences(of: "\"", with: "\\\"")
        let gql = """
        query {
            game(name: "\(safeQuery)") {
                id name boxArtURL(width: 110, height: 147)
                streams(first: \(limit)) {
                    edges {
                        node {
                            id title viewersCount previewImageURL(width: 640, height: 360) createdAt language
                            broadcaster { id login displayName profileImageURL(width: 70) }
                        }
                    }
                }
            }
            searchFor(userQuery: "\(safeQuery)", target: { index: CHANNEL }, platform: "web") {
                channels {
                    edges {
                        item {
                            ... on User {
                                id login displayName profileImageURL(width: 70)
                                stream {
                                    id title viewersCount previewImageURL(width: 640, height: 360) createdAt language
                                    game { id name }
                                }
                            }
                        }
                    }
                }
            }
        }
        """
        
        let data = try await executeGQLQuery(query: gql, variables: [:])
        let response = try await Task.detached { try JSONDecoder().decode(GQLResponse.self, from: data) }.value
        
        var liveStreams: [LiveStream] = []
        var channels: [LiveStreamBroadcaster] = []
        var categories: [Game] = []
        var seenLiveIds = Set<String>()
        var seenChannelIds = Set<String>()
        var seenCategoryIds = Set<String>()
        
        if let gameNode = response.data?.game {
            let game = Game(
                id: gameNode.id ?? "0",
                name: gameNode.name ?? query,
                boxArtURL: URL(string: gameNode.boxArtURL ?? "")
            )
            categories.append(game)
            if let id = game.id {
                seenCategoryIds.insert(id)
            }
            
            if let edges = gameNode.streams?.edges {
                for edge in edges {
                    if let node = edge.node, !seenLiveIds.contains(node.id) {
                        seenLiveIds.insert(node.id)
                        liveStreams.append(mapLiveNode(node, fallbackGame: query))
                    }
                }
            }
        }
        
        if let searchEdges = response.data?.searchFor?.channels?.edges {
            for result in searchEdges {
                guard let item = result.item, let id = item.id else { continue }
                
                if !seenChannelIds.contains(id) {
                    seenChannelIds.insert(id)
                    let broadcaster = LiveStreamBroadcaster(
                        id: id,
                        login: item.login ?? "",
                        displayName: item.displayName ?? "",
                        profileImageURL: URL(string: item.profileImageURL ?? "")
                    )
                    channels.append(broadcaster)
                    
                    if let stream = item.stream, !seenLiveIds.contains(stream.id) {
                        seenLiveIds.insert(stream.id)
                        let game = Game(
                            id: stream.game?.id ?? "0",
                            name: stream.game?.name ?? "Unknown",
                            boxArtURL: URL(string: stream.game?.boxArtURL ?? "")
                        )
                        let liveStream = LiveStream(
                            id: stream.id,
                            title: stream.title ?? "",
                            previewImageURL: URL(string: stream.previewImageURL ?? ""),
                            viewerCount: stream.viewersCount ?? 0,
                            language: stream.language,
                            startedAt: parseDate(stream.createdAt),
                            broadcaster: broadcaster,
                            game: game
                        )
                        liveStreams.append(liveStream)
                    }
                }
            }
        }
        
        liveStreams.sort(by: { $0.viewerCount > $1.viewerCount })
        
        return GlobalSearchResult(categories: categories, channels: channels, liveStreams: liveStreams)
    }
    
    func fetchChannelVODs(login: String, limit: Int = 20) async throws -> [VOD] {
        let gql = """
        query {
            user(login: "\(login)") {
                videos(first: \(limit)) {
                    edges {
                        node {
                            id title lengthSeconds previewThumbnailURL(width: 320, height: 180) createdAt viewCount broadcastType
                            game { id name boxArtURL(width: 138, height: 190) }
                            owner { id login displayName profileImageURL(width: 70) }
                        }
                    }
                }
            }
        }
        """
        
        let data = try await executeGQLQuery(query: gql, variables: [:])
        let response = try await Task.detached { try JSONDecoder().decode(GQLResponse.self, from: data) }.value
        return response.data?.user?.videos?.edges?.compactMap { edge in
            guard let node = edge.node else { return nil }
            return mapVideoNode(node)
        } ?? []
    }
    
    // Algorithme "light" pour les Trending VODs a été déplacé dans TwitchTrendingActor

    func fetchGameVODs(gameName: String, limit: Int = 15) async throws -> [VOD] {
        let safeName = gameName.replacingOccurrences(of: "\"", with: "\\\"")
        let gql = """
        query {
            game(name: "\(safeName)") {
                videos(first: \(limit)) {
                    edges {
                        node {
                            id title lengthSeconds previewThumbnailURL(width: 320, height: 180) createdAt viewCount broadcastType language
                            owner { id login displayName profileImageURL(width: 70) }
                            game { id name boxArtURL(width: 110, height: 147) }
                        }
                    }
                }
            }
        }
        """
        let data = try await executeGQLQuery(query: gql, variables: [:])
        let response = try await Task.detached { try JSONDecoder().decode(GQLResponse.self, from: data) }.value
        let edges = response.data?.game?.videos?.edges ?? []
        return edges.compactMap { $0.node }.compactMap { self.mapVideoNode($0) }
    }

    func fetchTrendingVODs(history: [PersistentHistoryEntry], subs: [PersistentSubscription]) async throws -> [VOD] {
        let watchedVODs: [VOD] = history.map { entry in
            VOD(
                id: entry.vodId,
                title: entry.title ?? "Unknown",
                lengthSeconds: entry.duration,
                previewThumbnailURL: entry.previewThumbnailURL,
                createdAt: entry.updatedAt,
                viewCount: entry.viewCount ?? 0,
                language: "en",
                broadcastType: "archive",
                game: Game(id: "0", name: entry.gameName ?? "Unknown", boxArtURL: nil),
                owner: VODOwner(login: entry.streamerName ?? "", displayName: entry.streamerName ?? "Unknown", profileImageURL: entry.streamerProfileURL)
            )
        }
        
        let historyData = history.map { HistoryEntryData(vodId: $0.vodId, duration: $0.duration, timecode: $0.timecode, updatedAt: $0.updatedAt) }
        let subData = subs.map { SubscriptionData(login: $0.login) }
        
        let trendingActor = TwitchTrendingActor()
        let profile = await trendingActor.buildPreferenceProfile(history: historyData, watchedVODs: watchedVODs, subs: subData)
        let subsSet = Set(subs.map { $0.login.lowercased() })
        
        var topGames: [String] = []
        let sortedGames = profile.gameScores.sorted(by: { $0.value > $1.value })
        topGames = Array(sortedGames.prefix(4).map { $0.key })
        if !topGames.contains("Just Chatting") {
            topGames.append("Just Chatting")
        }
        
        let topChannels = profile.channelScores.sorted(by: { $0.value > $1.value }).prefix(5).map { $0.key }
        
        var channelsToFetch = Set<String>()
        for sub in subs.prefix(20) { channelsToFetch.insert(sub.login.lowercased()) }
        for ch in topChannels { channelsToFetch.insert(ch) }
        
        if channelsToFetch.isEmpty {
            channelsToFetch.formUnion(["xqc", "kaicenat", "ibai", "summit1g", "zerator", "mistermv"])
        }
        
        var allCandidates: [VOD] = []
        
        await withTaskGroup(of: [VOD].self) { group in
            for game in topGames {
                group.addTask {
                    return (try? await self.fetchGameVODs(gameName: game, limit: 15)) ?? []
                }
            }
            
            for login in channelsToFetch {
                group.addTask {
                    let vodQuery = """
                    query {
                        user(login: "\(login)") {
                            videos(first: 15) {
                                edges {
                                    node {
                                        id title lengthSeconds previewThumbnailURL(width: 320, height: 180) createdAt viewCount broadcastType language
                                        owner { id login displayName profileImageURL(width: 70) }
                                        game { id name boxArtURL(width: 110, height: 147) }
                                    }
                                }
                            }
                        }
                    }
                    """
                    do {
                        let vodData = try await self.executeGQLQuery(query: vodQuery, variables: [:])
                        let vodResponse = try await Task.detached { try JSONDecoder().decode(GQLResponse.self, from: vodData) }.value
                        let edges = vodResponse.data?.user?.videos?.edges ?? []
                        return edges.compactMap { $0.node }.compactMap { self.mapVideoNode($0) }
                    } catch {
                        return []
                    }
                }
            }
            
            for await vods in group {
                allCandidates.append(contentsOf: vods)
            }
        }
        
        return await trendingActor.processCandidates(
            allCandidates: allCandidates,
            profile: profile,
            subsSet: subsSet
        )
    }

    func fetchVODs(ids: [String]) async throws -> [VOD] {
        guard !ids.isEmpty else { return [] }
        
        return await withTaskGroup(of: VOD?.self) { group in
            var vods: [VOD] = []
            
            for id in ids {
                group.addTask {
                    let gql = """
                    query {
                        video(id: "\(id)") {
                            id title lengthSeconds previewThumbnailURL(width: 320, height: 180) createdAt viewCount broadcastType
                            owner { id login displayName profileImageURL(width: 70) }
                            game { id name boxArtURL(width: 110, height: 147) }
                        }
                    }
                    """
                    do {
                        let data = try await self.executeGQLQuery(query: gql, variables: [:])
                        let response = try await Task.detached { try JSONDecoder().decode(GQLResponse.self, from: data) }.value
                        if let node = response.data?.video {
                            return self.mapVideoNode(node)
                        }
                    } catch {
                        print("Error fetching video \(id): \(error)")
                    }
                    return nil
                }
            }
            
            for await result in group {
                if let vod = result {
                    vods.append(vod)
                }
            }
            
            return vods
        }
    }


    func fetchCategoryDetails(gameName: String) async throws -> (lives: [LiveStream], vods: [VOD], clips: [VOD]) {
        let safeQuery = gameName.replacingOccurrences(of: "\"", with: "\\\"")
        let gql = """
        query {
            game(name: "\(safeQuery)") {
                streams(first: 5) {
                    edges {
                        node {
                            id title viewersCount previewImageURL(width: 640, height: 360) createdAt language
                            broadcaster { id login displayName profileImageURL(width: 70) }
                        }
                    }
                }
                videos(first: 5, sort: TRENDING) {
                    edges {
                        node {
                            id title lengthSeconds previewThumbnailURL(width: 320, height: 180) createdAt viewCount broadcastType
                            owner { id login displayName profileImageURL(width: 70) }
                            game { id name boxArtURL(width: 110, height: 147) }
                        }
                    }
                }
                clips(first: 5, criteria: { period: ALL_TIME }) {
                    edges {
                        node {
                            id title durationSeconds thumbnailURL createdAt viewCount
                            broadcaster { id login displayName profileImageURL(width: 70) }
                            game { id name boxArtURL(width: 110, height: 147) }
                        }
                    }
                }
            }
        }
        """
        
        let data = try await executeGQLQuery(query: gql, variables: [:])
        let response = try await Task.detached { try JSONDecoder().decode(GQLResponse.self, from: data) }.value
        
        var lives: [LiveStream] = []
        var vods: [VOD] = []
        var clips: [VOD] = []
        
        if let game = response.data?.game {
            if let streamEdges = game.streams?.edges {
                lives = streamEdges.compactMap { edge -> LiveStream? in
                    guard let node = edge.node, let broadcaster = node.broadcaster else { return nil }
                    return LiveStream(
                        id: node.id,
                        title: node.title ?? "",
                        previewImageURL: URL(string: node.previewImageURL ?? ""),
                        viewerCount: node.viewersCount ?? 0,
                        language: node.language,
                        startedAt: parseDate(node.createdAt),
                        broadcaster: LiveStreamBroadcaster(
                            id: broadcaster.id,
                            login: broadcaster.login,
                            displayName: broadcaster.displayName,
                            profileImageURL: URL(string: broadcaster.profileImageURL ?? "")
                        ),
                        game: Game(
                            id: game.id ?? "",
                            name: game.name ?? "",
                            boxArtURL: URL(string: game.boxArtURL ?? "")
                        )
                    )
                }
            }
            if let videoEdges = game.videos?.edges {
                vods = videoEdges.compactMap { edge -> VOD? in
                    guard let node = edge.node else { return nil }
                    return mapVideoNode(node)
                }
            }
            if let clipEdges = game.clips?.edges {
                clips = clipEdges.compactMap { edge -> VOD? in
                    guard let node = edge.node else { return nil }
                    return VOD(
                        id: node.id,
                        title: node.title ?? "",
                        lengthSeconds: node.durationSeconds ?? 0,
                        previewThumbnailURL: URL(string: node.thumbnailURL ?? ""),
                        createdAt: parseDate(node.createdAt),
                        viewCount: node.viewCount ?? 0,
                        language: nil,
                        broadcastType: "clip",
                        game: Game(
                            id: node.game?.id ?? "",
                            name: node.game?.name ?? "",
                            boxArtURL: URL(string: node.game?.boxArtURL ?? "")
                        ),
                        owner: VODOwner(
                            login: node.broadcaster?.login ?? "",
                            displayName: node.broadcaster?.displayName ?? "",
                            profileImageURL: URL(string: node.broadcaster?.profileImageURL ?? "")
                        )
                    )
                }
            }
        }
        
        return (lives, vods, clips)
    }
}

struct GlobalSearchResult {
    var categories: [Game]
    var channels: [LiveStreamBroadcaster]
    var liveStreams: [LiveStream]
}

extension TwitchAPIService {
    func fetchLiveStatus(for logins: [String]) async throws -> Set<String> {
        guard !logins.isEmpty else { return [] }
        
        let loginsStr = logins.map { "\"\($0)\"" }.joined(separator: ", ")
        let gql = """
        query {
            users(logins: [\(loginsStr)]) {
                login
                stream {
                    id
                }
            }
        }
        """
        
        let data = try await executeGQLQuery(query: gql, variables: [:])
        
        struct StatusResponse: Codable {
            struct StatusData: Codable {
                struct StatusUser: Codable {
                    let login: String
                    let stream: StatusStream?
                    struct StatusStream: Codable { let id: String }
                }
                let users: [StatusUser]?
            }
            let data: StatusData?
        }
        
        let response = try await Task.detached { try JSONDecoder().decode(StatusResponse.self, from: data) }.value
        
        let liveLogins = response.data?.users?.compactMap { user in
            user.stream != nil ? user.login : nil
        } ?? []
        
        return Set(liveLogins)
    }
}
