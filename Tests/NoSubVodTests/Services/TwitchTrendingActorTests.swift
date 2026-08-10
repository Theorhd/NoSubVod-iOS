import XCTest
@testable import NoSubVod

final class TwitchTrendingActorTests: XCTestCase {

    var actor: TwitchTrendingActor!

    override func setUp() async throws {
        actor = TwitchTrendingActor()
    }


    func testBuildProfile_emptyHistory_returnsZeroScores() async {
        let profile = await actor.buildPreferenceProfile(
            history: [],
            watchedVODs: [],
            subs: []
        )

        XCTAssertEqual(profile.gameScores.count, 0)
        XCTAssertEqual(profile.channelScores.count, 0)
        // FR boost: frScore 0 < 1.2, so +1.2 added
        XCTAssertEqual(profile.languageScores["fr"], 1.2)
    }

    func testBuildProfile_fullWatch_weightIsOne() async {
        let vodId = "vod-1"
        let history = [HistoryEntryData(vodId: vodId, duration: 1000, timecode: 950, updatedAt: Date())]
        let vod = VOD(
            id: vodId, title: "Test", lengthSeconds: 1000,
            previewThumbnailURL: nil, createdAt: Date(), viewCount: 100,
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Just Chatting", boxArtURL: nil),
            owner: VODOwner(login: "teststreamer", displayName: "TestStreamer", profileImageURL: nil)
        )

        let profile = await actor.buildPreferenceProfile(
            history: history,
            watchedVODs: [vod],
            subs: []
        )

        // ratio 950/1000 = 0.95 > 0.8 → weight 1.0, recency 1.0 (just updated) → weighted = 1.0
        XCTAssertEqual(profile.gameScores["Just Chatting"] ?? 0, 1.0, accuracy: 0.001)
        XCTAssertEqual(profile.channelScores["teststreamer"] ?? 0, 1.0, accuracy: 0.001)
        XCTAssertEqual(profile.languageScores["en"] ?? 0, 1.0, accuracy: 0.001)
    }

    func testBuildProfile_mediumWatch_weightIsPointEight() async {
        let vodId = "vod-1"
        // ratio = 600/1000 = 0.6 → weight 0.8 (0.5 < 0.6 <= 0.8)
        let history = [HistoryEntryData(vodId: vodId, duration: 1000, timecode: 600, updatedAt: Date())]
        let vod = VOD(
            id: vodId, title: "Test", lengthSeconds: 1000,
            previewThumbnailURL: nil, createdAt: Date(), viewCount: 100,
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Valorant", boxArtURL: nil),
            owner: VODOwner(login: "testgamer", displayName: "TestGamer", profileImageURL: nil)
        )

        let profile = await actor.buildPreferenceProfile(
            history: history,
            watchedVODs: [vod],
            subs: []
        )

        XCTAssertEqual(profile.gameScores["Valorant"] ?? 0, 0.8, accuracy: 0.001)
        XCTAssertEqual(profile.channelScores["testgamer"] ?? 0, 0.8, accuracy: 0.001)
    }

    func testBuildProfile_lowWatch_weightIsPointFive() async {
        let vodId = "vod-1"
        // ratio = 300/1000 = 0.3 → weight 0.5 (0.1 < 0.3 <= 0.5)
        let history = [HistoryEntryData(vodId: vodId, duration: 1000, timecode: 300, updatedAt: Date())]
        let vod = VOD(
            id: vodId, title: "Test", lengthSeconds: 1000,
            previewThumbnailURL: nil, createdAt: Date(), viewCount: 100,
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Minecraft", boxArtURL: nil),
            owner: VODOwner(login: "builder", displayName: "Builder", profileImageURL: nil)
        )

        let profile = await actor.buildPreferenceProfile(
            history: history,
            watchedVODs: [vod],
            subs: []
        )

        XCTAssertEqual(profile.gameScores["Minecraft"] ?? 0, 0.5, accuracy: 0.001)
    }

    func testBuildProfile_veryLowWatch_weightIsPointTwo() async {
        let vodId = "vod-1"
        // ratio = 50/1000 = 0.05 → weight 0.2 (< 0.1)
        let history = [HistoryEntryData(vodId: vodId, duration: 1000, timecode: 50, updatedAt: Date())]
        let vod = VOD(
            id: vodId, title: "Test", lengthSeconds: 1000,
            previewThumbnailURL: nil, createdAt: Date(), viewCount: 100,
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Chess", boxArtURL: nil),
            owner: VODOwner(login: "chessmaster", displayName: "ChessMaster", profileImageURL: nil)
        )

        let profile = await actor.buildPreferenceProfile(
            history: history,
            watchedVODs: [vod],
            subs: []
        )

        XCTAssertEqual(profile.gameScores["Chess"] ?? 0, 0.2, accuracy: 0.001)
    }

    func testBuildProfile_recencyDecay_oldWatch() async {
        let vodId = "vod-1"
        // Watch from 45 days ago → recency penalty = max(0.35, min(1.0, 1.0 - 45/45)) = max(0.35, 0.0) = 0.35
        let oldDate = Date().addingTimeInterval(-45 * 86400)
        let history = [HistoryEntryData(vodId: vodId, duration: 1000, timecode: 1000, updatedAt: oldDate)]
        let vod = VOD(
            id: vodId, title: "Old VOD", lengthSeconds: 1000,
            previewThumbnailURL: nil, createdAt: oldDate, viewCount: 50,
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Old Game", boxArtURL: nil),
            owner: VODOwner(login: "oldstreamer", displayName: "OldStreamer", profileImageURL: nil)
        )

        let profile = await actor.buildPreferenceProfile(
            history: history,
            watchedVODs: [vod],
            subs: []
        )

        // weight = 1.0 (full watch), recency = 0.35, weighted = 0.35
        XCTAssertEqual(profile.gameScores["Old Game"] ?? 0, 0.35, accuracy: 0.01)
    }

    func testBuildProfile_subsBoost_channelScore() async {
        let subs = [SubscriptionData(login: "favoriteStreamer")]
        let profile = await actor.buildPreferenceProfile(
            history: [],
            watchedVODs: [],
            subs: subs
        )

        // sub gives +1.75 to channel score
        XCTAssertEqual(profile.channelScores["favoritestreamer"], 1.75)
    }

    func testBuildProfile_frBoostWhenLow() async {
        let profile = await actor.buildPreferenceProfile(
            history: [],
            watchedVODs: [],
            subs: []
        )

        // frScore starts at 0.0, which is < 1.2 → +1.2
        XCTAssertEqual(profile.languageScores["fr"], 1.2)
    }

    func testBuildProfile_noFrBoostWhenAlreadyHigh() async {
        let vodId = "vod-1"
        // Multiple French watches to accumulate fr score > 1.2
        let history = [
            HistoryEntryData(vodId: vodId, duration: 1000, timecode: 1000, updatedAt: Date()),
            HistoryEntryData(vodId: "vod-2", duration: 1000, timecode: 1000, updatedAt: Date()),
        ]
        let vods = [
            VOD(id: vodId, title: "FR1", lengthSeconds: 1000, previewThumbnailURL: nil, createdAt: Date(), viewCount: 100, language: "fr", broadcastType: "archive", game: Game(id: "1", name: "Game", boxArtURL: nil), owner: VODOwner(login: "s1", displayName: "S1", profileImageURL: nil)),
            VOD(id: "vod-2", title: "FR2", lengthSeconds: 1000, previewThumbnailURL: nil, createdAt: Date(), viewCount: 100, language: "fr", broadcastType: "archive", game: Game(id: "2", name: "Game2", boxArtURL: nil), owner: VODOwner(login: "s2", displayName: "S2", profileImageURL: nil)),
        ]

        let profile = await actor.buildPreferenceProfile(
            history: history,
            watchedVODs: vods,
            subs: []
        )

        // Two FR watches → fr score >= 2.0, which is >= 1.2 → no extra boost
        // Each watch gives 1.0 (full watch + recent), so fr = 2.0
        XCTAssertEqual(profile.languageScores["fr"] ?? 0, 2.0, accuracy: 0.001)
    }

    func testBuildProfile_cumulativeScores() async {
        let vodId1 = "vod-1"
        let vodId2 = "vod-2"
        let history = [
            HistoryEntryData(vodId: vodId1, duration: 1000, timecode: 1000, updatedAt: Date()),
            HistoryEntryData(vodId: vodId2, duration: 1000, timecode: 1000, updatedAt: Date()),
        ]
        let vods = [
            VOD(id: vodId1, title: "VOD1", lengthSeconds: 1000, previewThumbnailURL: nil, createdAt: Date(), viewCount: 100, language: "en", broadcastType: "archive", game: Game(id: "1", name: "Valorant", boxArtURL: nil), owner: VODOwner(login: "testgamer", displayName: "TG", profileImageURL: nil)),
            VOD(id: vodId2, title: "VOD2", lengthSeconds: 1000, previewThumbnailURL: nil, createdAt: Date(), viewCount: 100, language: "en", broadcastType: "archive", game: Game(id: "1", name: "Valorant", boxArtURL: nil), owner: VODOwner(login: "testgamer", displayName: "TG", profileImageURL: nil)),
        ]

        let profile = await actor.buildPreferenceProfile(
            history: history,
            watchedVODs: vods,
            subs: []
        )

        // Two full watches of same game and channel → scores add up
        XCTAssertEqual(profile.gameScores["Valorant"] ?? 0, 2.0, accuracy: 0.001)
        XCTAssertEqual(profile.channelScores["testgamer"] ?? 0, 2.0, accuracy: 0.001)
    }

    func testBuildProfile_ignoresVODWithoutHistory() async {
        let vodId = "vod-1"
        let history = [HistoryEntryData(vodId: vodId, duration: 1000, timecode: 1000, updatedAt: Date())]
        // VOD with different ID → no matching history entry
        let vod = VOD(
            id: "different-id", title: "No Match", lengthSeconds: 1000,
            previewThumbnailURL: nil, createdAt: Date(), viewCount: 100,
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Game", boxArtURL: nil),
            owner: VODOwner(login: "streamer", displayName: "S", profileImageURL: nil)
        )

        let profile = await actor.buildPreferenceProfile(
            history: history,
            watchedVODs: [vod],
            subs: []
        )

        // No history match → VOD contributes nothing (only FR boost)
        XCTAssertEqual(profile.gameScores.count, 0)
        XCTAssertEqual(profile.channelScores.count, 0)
    }


    func testScoreCandidate_veryShortVOD_penalized() async {
        let profile = PreferenceProfile(gameScores: [:], channelScores: [:], languageScores: [:])
        let vod = VOD(
            id: "short", title: "Short", lengthSeconds: 30, // < 60 → lengthFactor 0.01
            previewThumbnailURL: nil, createdAt: Date(), viewCount: 100,
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Game", boxArtURL: nil),
            owner: VODOwner(login: "streamer", displayName: "S", profileImageURL: nil)
        )

        let score = await actor.scoreCandidateVOD(vod, profile: profile, subsSet: [])
        // quality = lengthFactor * viewFactor = 0.01 * 1.0 = 0.01 < 0.05 → returns quality (short-circuit)
        XCTAssertEqual(score, 0.01, accuracy: 0.001)
    }

    func testScoreCandidate_longVOD_bestLengthFactor() async {
        let profile = PreferenceProfile(gameScores: [:], channelScores: [:], languageScores: [:])
        let vod = VOD(
            id: "long", title: "Long", lengthSeconds: 3600, // >= 1800 → lengthFactor 1.0
            previewThumbnailURL: nil, createdAt: Date(), viewCount: 500, // >= 50 → viewFactor 1.0
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Game", boxArtURL: nil),
            owner: VODOwner(login: "streamer", displayName: "S", profileImageURL: nil)
        )

        let score = await actor.scoreCandidateVOD(vod, profile: profile, subsSet: [])
        // quality = 1.0 * 1.0 = 1.0
        // base = popularity + recency = log10(510) * 1.15 + 2.1
        // log10(510) ≈ 2.707, *1.15 ≈ 3.11, + 2.1 = 5.21
        // score = 5.21 * 1.0 ≈ 5.21
        XCTAssertGreaterThan(score, 5.0)
    }

    func testScoreCandidate_zeroViews_penalized() async {
        let profile = PreferenceProfile(gameScores: [:], channelScores: [:], languageScores: [:])
        let vod = VOD(
            id: "no-views", title: "No Views", lengthSeconds: 3600,
            previewThumbnailURL: nil, createdAt: Date(), viewCount: 0, // → viewFactor 0.04
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Game", boxArtURL: nil),
            owner: VODOwner(login: "streamer", displayName: "S", profileImageURL: nil)
        )

        let score = await actor.scoreCandidateVOD(vod, profile: profile, subsSet: [])
        // quality = 1.0 * 0.04 = 0.04 < 0.05 → short-circuit returns 0.04
        XCTAssertEqual(score, 0.04, accuracy: 0.001)
    }

    func testScoreCandidate_frenchLanguage_boost() async {
        let profile = PreferenceProfile(gameScores: [:], channelScores: [:], languageScores: [:])
        let vod = VOD(
            id: "fr-vod", title: "VOD FR", lengthSeconds: 3600,
            previewThumbnailURL: nil, createdAt: Date(), viewCount: 500,
            language: "fr", broadcastType: "archive",
            game: Game(id: "1", name: "Game", boxArtURL: nil),
            owner: VODOwner(login: "streamerFR", displayName: "SFR", profileImageURL: nil)
        )

        let scoreWithFR = await actor.scoreCandidateVOD(vod, profile: profile, subsSet: [])
        // FR boost = 2.3

        // Same VOD but english
        let vodEN = VOD(
            id: "en-vod", title: "VOD EN", lengthSeconds: 3600,
            previewThumbnailURL: nil, createdAt: Date(), viewCount: 500,
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Game", boxArtURL: nil),
            owner: VODOwner(login: "streamerEN", displayName: "SEN", profileImageURL: nil)
        )
        let scoreEN = await actor.scoreCandidateVOD(vodEN, profile: profile, subsSet: [])

        // FR score should be higher (2.3 boost vs 0 for EN)
        XCTAssertEqual(scoreWithFR - scoreEN, 2.3, accuracy: 0.01)
    }

    func testScoreCandidate_subscriber_boost() async {
        let profile = PreferenceProfile(gameScores: [:], channelScores: [:], languageScores: [:])
        let vod = VOD(
            id: "sub-vod", title: "Sub VOD", lengthSeconds: 3600,
            previewThumbnailURL: nil, createdAt: Date(), viewCount: 500,
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Game", boxArtURL: nil),
            owner: VODOwner(login: "subbedchannel", displayName: "Subbed", profileImageURL: nil)
        )

        let scoreSubbed = await actor.scoreCandidateVOD(vod, profile: profile, subsSet: ["subbedchannel"])

        // Same VOD but not subbed
        let vodNotSub = VOD(
            id: "nosub-vod", title: "No Sub", lengthSeconds: 3600,
            previewThumbnailURL: nil, createdAt: Date(), viewCount: 500,
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Game", boxArtURL: nil),
            owner: VODOwner(login: "otherchannel", displayName: "Other", profileImageURL: nil)
        )
        let scoreNotSubbed = await actor.scoreCandidateVOD(vodNotSub, profile: profile, subsSet: ["subbedchannel"])

        // Sub boost = 3.2
        XCTAssertEqual(scoreSubbed - scoreNotSubbed, 3.2, accuracy: 0.01)
    }

    func testScoreCandidate_recencyDecaysOverTime() async {
        let profile = PreferenceProfile(gameScores: [:], channelScores: [:], languageScores: [:])

        let recentVOD = VOD(
            id: "recent", title: "Recent", lengthSeconds: 3600,
            previewThumbnailURL: nil, createdAt: Date(), viewCount: 500,
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Game", boxArtURL: nil),
            owner: VODOwner(login: "streamer", displayName: "S", profileImageURL: nil)
        )

        let oldVOD = VOD(
            id: "old", title: "Old", lengthSeconds: 3600,
            previewThumbnailURL: nil, createdAt: Date().addingTimeInterval(-9 * 86400), viewCount: 500,
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Game", boxArtURL: nil),
            owner: VODOwner(login: "streamer", displayName: "S", profileImageURL: nil)
        )

        let scoreRecent = await actor.scoreCandidateVOD(recentVOD, profile: profile, subsSet: [])
        let scoreOld = await actor.scoreCandidateVOD(oldVOD, profile: profile, subsSet: [])

        // Recent should score higher (recency penalty on old)
        XCTAssertGreaterThan(scoreRecent, scoreOld)
    }

    func testScoreCandidate_gameAffinity_boost() async {
        let profile = PreferenceProfile(
            gameScores: ["Valorant": 5.0],
            channelScores: [:],
            languageScores: [:]
        )
        let vod = VOD(
            id: "val-vod", title: "Val VOD", lengthSeconds: 3600,
            previewThumbnailURL: nil, createdAt: Date(), viewCount: 500,
            language: "en", broadcastType: "archive",
            game: Game(id: "1", name: "Valorant", boxArtURL: nil),
            owner: VODOwner(login: "streamer", displayName: "S", profileImageURL: nil)
        )

        let score = await actor.scoreCandidateVOD(vod, profile: profile, subsSet: [])
        // gameAffinity = 5.0 * 2.1 = 10.5
        XCTAssertGreaterThan(score, 10.0)
    }


    func testInterleave_emptyCandidates_returnsEmpty() async {
        let result = await actor.interleaveLocalizedFeed(
            candidates: [],
            foreignRatio: 0.3,
            maxItems: 10
        )
        XCTAssertTrue(result.isEmpty)
    }

    func testInterleave_onlyFrench_returnsOnlyFrench() async {
        let vods = (1...5).map { i in
            VOD(id: "fr-\(i)", title: "FR \(i)", lengthSeconds: 3600,
                previewThumbnailURL: nil, createdAt: Date(), viewCount: 100,
                language: "fr", broadcastType: "archive",
                game: nil, owner: nil)
        }
        let candidates = vods.enumerated().map { ScoredVOD(vod: $0.1, score: Double(5 - $0.0)) }

        let result = await actor.interleaveLocalizedFeed(
            candidates: candidates,
            foreignRatio: 0.0, // no foreign desired
            maxItems: 10
        )

        XCTAssertEqual(result.count, 5)
        // All should be French
        for vod in result {
            XCTAssertEqual(vod.language, "fr")
        }
        // Sorted by score descending (fr-1 has highest score: 5 -> 4, fr-5 lowest: 1)
        XCTAssertEqual(result.first?.id, "fr-1")
    }

    func testInterleave_ratioRespected() async {
        // 5 FR + 5 EN, foreignRatio = 0.4
        let frVODs = (1...5).map { i in
            VOD(id: "fr-\(i)", title: "FR", lengthSeconds: 3600,
                previewThumbnailURL: nil, createdAt: Date(), viewCount: 100,
                language: "fr", broadcastType: "archive", game: nil, owner: nil)
        }
        let enVODs = (1...5).map { i in
            VOD(id: "en-\(i)", title: "EN", lengthSeconds: 3600,
                previewThumbnailURL: nil, createdAt: Date(), viewCount: 100,
                language: "en", broadcastType: "archive", game: nil, owner: nil)
        }
        let all = (frVODs.enumerated().map { ScoredVOD(vod: $0.1, score: Double(10 - $0.0)) } +
                   enVODs.enumerated().map { ScoredVOD(vod: $0.1, score: Double(5 - $0.0)) })

        let result = await actor.interleaveLocalizedFeed(
            candidates: all,
            foreignRatio: 0.4,
            maxItems: 10
        )

        // Should have 10 items total
        XCTAssertEqual(result.count, 10)
        // Check that foreign content is present (not all FR)
        let foreignCount = result.filter { $0.language != "fr" }.count
        XCTAssertGreaterThan(foreignCount, 0)
        // Foreign content ratio should be around 0.4 (allow some tolerance for interleaving)
        let ratio = Double(foreignCount) / Double(result.count)
        XCTAssertGreaterThanOrEqual(ratio, 0.3)
        XCTAssertLessThanOrEqual(ratio, 0.5)
    }

    func testInterleave_maxItems_respected() async {
        let vods = (1...30).map { i in
            VOD(id: "vod-\(i)", title: "VOD \(i)", lengthSeconds: 3600,
                previewThumbnailURL: nil, createdAt: Date(), viewCount: 100,
                language: i % 2 == 0 ? "fr" : "en", broadcastType: "archive",
                game: nil, owner: nil)
        }
        let candidates = vods.enumerated().map { ScoredVOD(vod: $0.1, score: Double(30 - $0.0)) }

        let result = await actor.interleaveLocalizedFeed(
            candidates: candidates,
            foreignRatio: 0.3,
            maxItems: 5
        )

        XCTAssertEqual(result.count, 5)
    }

    func testInterleave_onlyForeign_returnsOnlyForeign() async {
        let vods = (1...5).map { idx in
            VOD(id: "en-\(idx)", title: "EN \(idx)", lengthSeconds: 3600,
                previewThumbnailURL: nil, createdAt: Date(), viewCount: 100,
                language: "en", broadcastType: "archive", game: nil, owner: nil)
        }
        let candidates = vods.enumerated().map { ScoredVOD(vod: $0.1, score: Double(5 - $0.0)) }

        let result = await actor.interleaveLocalizedFeed(
            candidates: candidates,
            foreignRatio: 1.0,
            maxItems: 10
        )

        XCTAssertEqual(result.count, 5)
        for vod in result {
            XCTAssertEqual(vod.language, "en")
        }
    }


    func testProcessCandidates_deduplicatesByID() async {
        let vod = VOD(id: "dup", title: "Duplicate", lengthSeconds: 3600, previewThumbnailURL: nil, createdAt: Date(), viewCount: 100, language: "en", broadcastType: "archive", game: nil, owner: nil)
        let profile = PreferenceProfile(gameScores: [:], channelScores: [:], languageScores: [:])

        let result = await actor.processCandidates(
            allCandidates: [vod, vod, vod],
            profile: profile,
            subsSet: []
        )

        // All have same ID → deduped to 1
        let dupIDs = result.filter { $0.id == "dup" }
        XCTAssertEqual(dupIDs.count, 1)
    }

    func testProcessCandidates_channelLimits_favorites() async {
        let profile = PreferenceProfile(gameScores: [:], channelScores: ["fav": 1.0], languageScores: [:])
        let vods = (1...10).map { i in
            VOD(id: "fav-\(i)", title: "Fav \(i)", lengthSeconds: 3600, previewThumbnailURL: nil, createdAt: Date(), viewCount: 500, language: "en", broadcastType: "archive", game: Game(id: "1", name: "Game", boxArtURL: nil), owner: VODOwner(login: "fav", displayName: "Fav", profileImageURL: nil))
        }

        let result = await actor.processCandidates(
            allCandidates: vods,
            profile: profile,
            subsSet: ["fav"]
        )

        // Favorite channel + sub → max 4 slots
        let favCount = result.filter { $0.owner?.login == "fav" }.count
        XCTAssertLessThanOrEqual(favCount, 4)
    }

    func testProcessCandidates_channelLimits_nonFavorites() async {
        let profile = PreferenceProfile(gameScores: [:], channelScores: [:], languageScores: [:])
        let vods = (1...10).map { i in
            VOD(id: "other-\(i)", title: "Other \(i)", lengthSeconds: 3600, previewThumbnailURL: nil, createdAt: Date(), viewCount: 500, language: "en", broadcastType: "archive", game: Game(id: "1", name: "Game", boxArtURL: nil), owner: VODOwner(login: "other", displayName: "Other", profileImageURL: nil))
        }

        let result = await actor.processCandidates(
            allCandidates: vods,
            profile: profile,
            subsSet: []
        )

        // Not a favorite → max 2 slots
        let otherCount = result.filter { $0.owner?.login == "other" }.count
        XCTAssertLessThanOrEqual(otherCount, 2)
    }

    func testProcessCandidates_maxTotalItems() async {
        let vods = (1...200).map { i in
            VOD(id: "vod-\(i)", title: "VOD \(i)", lengthSeconds: 3600, previewThumbnailURL: nil, createdAt: Date(), viewCount: 500, language: "en", broadcastType: "archive", game: nil, owner: VODOwner(login: "channel-\(i)", displayName: "C\(i)", profileImageURL: nil))
        }
        let profile = PreferenceProfile(gameScores: [:], channelScores: [:], languageScores: [:])

        let result = await actor.processCandidates(
            allCandidates: vods,
            profile: profile,
            subsSet: []
        )

        XCTAssertLessThanOrEqual(result.count, 60)
    }
}
