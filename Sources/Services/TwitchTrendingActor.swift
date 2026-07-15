import Foundation

public struct HistoryEntryData: Sendable {
    let vodId: String
    let duration: Int
    let timecode: Int
    let updatedAt: Date
}

public struct SubscriptionData: Sendable {
    let login: String
}

public struct PreferenceProfile: Sendable {
    var gameScores: [String: Double]
    var channelScores: [String: Double]
    var languageScores: [String: Double]
}

public struct ScoredVOD: Sendable {
    let vod: VOD
    let score: Double
}

actor TwitchTrendingActor {
    
    func buildPreferenceProfile(
        history: [HistoryEntryData],
        watchedVODs: [VOD],
        subs: [SubscriptionData]
    ) -> PreferenceProfile {
        var gameScores: [String: Double] = [:]
        var channelScores: [String: Double] = [:]
        var languageScores: [String: Double] = [:]
        
        let historyById = Dictionary(uniqueKeysWithValues: history.map { ($0.vodId, $0) })
        let now = Date()
        
        for vod in watchedVODs {
            guard let entry = historyById[vod.id] else { continue }
            
            let watchWeight: Double
            if entry.duration > 0 {
                let ratio = Double(entry.timecode) / Double(entry.duration)
                if ratio > 0.8 { watchWeight = 1.0 }
                else if ratio > 0.5 { watchWeight = 0.8 }
                else if ratio > 0.1 { watchWeight = 0.5 }
                else { watchWeight = 0.2 }
            } else {
                watchWeight = 0.5
            }
            
            let ageSeconds = now.timeIntervalSince(entry.updatedAt)
            let recencyPenalty = max(0.35, min(1.0, 1.0 - (ageSeconds / (86400.0 * 45.0))))
            let weighted = watchWeight * recencyPenalty
            
            if let game = vod.game?.name, !game.isEmpty {
                gameScores[game, default: 0.0] += weighted
            }
            
            if let owner = vod.owner?.login {
                let login = owner.lowercased()
                if !login.isEmpty {
                    channelScores[login, default: 0.0] += weighted
                }
            }
            
            let lang = (vod.language ?? "").lowercased()
            if !lang.isEmpty {
                languageScores[lang, default: 0.0] += weighted
            }
        }
        
        for sub in subs {
            let login = sub.login.lowercased()
            channelScores[login, default: 0.0] += 1.75
        }
        
        let frScore = languageScores["fr"] ?? 0.0
        if frScore < 1.2 {
            languageScores["fr"] = frScore + 1.2
        }
        
        return PreferenceProfile(gameScores: gameScores, channelScores: channelScores, languageScores: languageScores)
    }

    func scoreCandidateVOD(_ vod: VOD, profile: PreferenceProfile, subsSet: Set<String>) -> Double {
        let lengthSecs = Double(vod.lengthSeconds)
        let lengthFactor: Double
        if lengthSecs < 60.0 {
            lengthFactor = 0.01
        } else if lengthSecs < 600.0 {
            let ratio = (lengthSecs - 60.0) / 540.0
            lengthFactor = 0.01 + 0.17 * ratio * ratio
        } else if lengthSecs < 1800.0 {
            lengthFactor = 0.18 + 0.82 * (lengthSecs - 600.0) / 1200.0
        } else {
            lengthFactor = 1.0
        }
        
        let viewFactor: Double
        let views = Double(vod.viewCount)
        if views == 0 {
            viewFactor = 0.04
        } else if views < 5 {
            viewFactor = 0.04 + 0.46 * (views / 5.0)
        } else if views < 50 {
            viewFactor = 0.5 + 0.5 * (views / 50.0)
        } else {
            viewFactor = 1.0
        }
        
        let quality = lengthFactor * viewFactor
        if quality < 0.05 { return quality }
        
        let gameName = vod.game?.name ?? ""
        let channelLogin = (vod.owner?.login ?? "").lowercased()
        let language = (vod.language ?? "").lowercased()
        
        let popularity = log10(views + 10.0) * 1.15
        
        let gameAffinity = (profile.gameScores[gameName] ?? 0.0) * 2.1
        let channelAffinity = (profile.channelScores[channelLogin] ?? 0.0) * 2.4
        let langAffinity = (profile.languageScores[language] ?? 0.0) * 1.15
        
        let frBoost = language == "fr" ? 2.3 : 0.0
        let subBoost = subsSet.contains(channelLogin) ? 3.2 : 0.0
        
        let ageDays = max(0, Date().timeIntervalSince(vod.createdAt) / 86400.0)
        let recency = max(0.0, min(2.1, 2.1 - ageDays / 9.0))
        
        let baseScore = popularity + gameAffinity + channelAffinity + langAffinity + frBoost + subBoost + recency
        
        return baseScore * quality
    }
    
    func interleaveLocalizedFeed(candidates: [ScoredVOD], foreignRatio: Double, maxItems: Int) -> [VOD] {
        var french: [ScoredVOD] = []
        var foreign: [ScoredVOD] = []
        
        for sv in candidates {
            if (sv.vod.language ?? "").lowercased() == "fr" {
                french.append(sv)
            } else {
                foreign.append(sv)
            }
        }
        
        french.sort(by: { $0.score > $1.score })
        foreign.sort(by: { $0.score > $1.score })
        
        var feed: [ScoredVOD] = []
        var fi = 0
        var foi = 0
        var foreignAdded = 0
        
        while feed.count < maxItems && (fi < french.count || foi < foreign.count) {
            let lastFour = feed.suffix(4).map { ($0.vod.language ?? "").lowercased() == "fr" }
            let frenchStreak = lastFour.count == 4 && lastFour.allSatisfy { $0 }
            let foreignStreak = !lastFour.isEmpty && lastFour.allSatisfy { !$0 }
            
            let targetForeign = Int(floor(Double(feed.count + 1) * foreignRatio))
            let shouldPickForeign = !foreignStreak && foi < foreign.count && (foreignAdded < targetForeign || fi >= french.count || frenchStreak)
            
            if shouldPickForeign {
                feed.append(foreign[foi])
                foi += 1
                foreignAdded += 1
            } else if fi < french.count {
                feed.append(french[fi])
                fi += 1
            } else if foi < foreign.count {
                feed.append(foreign[foi])
                foi += 1
                foreignAdded += 1
            }
        }
        
        return feed.map { $0.vod }
    }
    
    func processCandidates(
        allCandidates: [VOD],
        profile: PreferenceProfile,
        subsSet: Set<String>
    ) -> [VOD] {
        var deduped: [String: VOD] = [:]
        for vod in allCandidates {
            if deduped[vod.id] == nil {
                deduped[vod.id] = vod
            }
        }
        
        var scored: [ScoredVOD] = deduped.values.map { vod in
            ScoredVOD(vod: vod, score: self.scoreCandidateVOD(vod, profile: profile, subsSet: subsSet))
        }
        scored.sort(by: { $0.score > $1.score })
        scored = Array(scored.prefix(400))
        
        var channelCount: [String: Int] = [:]
        scored.removeAll { sv in
            let login = (sv.vod.owner?.login ?? "").lowercased()
            let isFavorite = subsSet.contains(login) || profile.channelScores[login] != nil
            let maxSlots = isFavorite ? 4 : 2
            
            let count = channelCount[login] ?? 0
            if count < maxSlots {
                channelCount[login] = count + 1
                return false
            } else {
                return true
            }
        }
        
        let totalLangWeight = profile.languageScores.values.reduce(0.0, +)
        let foreignWeight = totalLangWeight - (profile.languageScores["fr"] ?? 0.0)
        let foreignRatio = totalLangWeight > 0.0 ? (foreignWeight / totalLangWeight) * 0.9 : 0.0
        
        return interleaveLocalizedFeed(candidates: scored, foreignRatio: foreignRatio, maxItems: 60)
    }
}
