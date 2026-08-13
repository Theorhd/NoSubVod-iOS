import Foundation
import Combine

struct GitHubRelease: Codable, Sendable {
    let tagName: String
    let htmlUrl: String
    let name: String?
    let body: String?

    enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case htmlUrl = "html_url"
        case name
        case body
    }

    var displayVersion: String {
        var clean = tagName.trimmingCharacters(in: .whitespacesAndNewlines)
        if clean.lowercased().hasPrefix("v") {
            clean = String(clean.dropFirst())
        }
        return clean
    }
}

final class UpdateManager: ObservableObject, @unchecked Sendable {
    static let shared = UpdateManager()

    @Published private(set) var isUpdateAvailable: Bool = false
    @Published private(set) var latestRelease: GitHubRelease? = nil
    @Published private(set) var isChecking: Bool = false

    private let repoOwner = "Theorhd"
    private let repoName = "NoSubVod-iOS"

    private init() {}

    @MainActor
    func checkForUpdates() async {
        guard !isChecking else { return }
        isChecking = true
        defer { isChecking = false }

        guard let url = URL(string: "https://api.github.com/repos/\(repoOwner)/\(repoName)/releases/latest") else {
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("NoSubVod-iOS/UpdateChecker", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 10.0

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                return
            }

            let release = try JSONDecoder().decode(GitHubRelease.self, from: data)
            let currentVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"

            let updateAvailable = Self.compareVersions(current: currentVersion, latest: release.displayVersion)

            self.latestRelease = release
            self.isUpdateAvailable = updateAvailable
        } catch {
            // Silence network or parsing errors for update check
        }
    }

    /// Compares two semver strings (e.g. "1.1.1" vs "1.2.0").
    /// Returns true if `latest` is strictly greater than `current`.
    static func compareVersions(current: String, latest: String) -> Bool {
        let cleanCurrent = sanitizeVersion(current)
        let cleanLatest = sanitizeVersion(latest)

        let currentComponents = cleanCurrent.split(separator: ".").compactMap { Int($0) }
        let latestComponents = cleanLatest.split(separator: ".").compactMap { Int($0) }

        let maxCount = max(currentComponents.count, latestComponents.count)

        for i in 0..<maxCount {
            let currentVal = i < currentComponents.count ? currentComponents[i] : 0
            let latestVal = i < latestComponents.count ? latestComponents[i] : 0

            if latestVal > currentVal {
                return true
            } else if latestVal < currentVal {
                return false
            }
        }

        return false
    }

    private static func sanitizeVersion(_ raw: String) -> String {
        var str = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if str.lowercased().hasPrefix("v") {
            str = String(str.dropFirst())
        }
        return str
    }
}
