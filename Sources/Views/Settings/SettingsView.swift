import SwiftUI
import SwiftData

struct SettingsView: View {
    @AppStorage("defaultVideoQuality") private var defaultVideoQuality = "auto"
    @AppStorage("defaultVideoQualityCellular") private var defaultVideoQualityCellular = "auto"
    @AppStorage("defaultDownloadQuality") private var defaultDownloadQuality = "chunked"
    @AppStorage("downloadNetworkPreference") private var downloadNetworkPreference = "all"
    @AppStorage("appTheme") private var appTheme = "system"
    @AppStorage("appLanguage") private var appLanguage = "en"
    @AppStorage("isDebugModeEnabled") private var isDebugModeEnabled = false
    @AppStorage("isLiveContainerStorageEnabled") private var isLiveContainerStorageEnabled = false
    @AppStorage("adBlockMode") private var adBlockMode = AdBlockMode.local.rawValue
    @AppStorage("ttvProxyURL") private var ttvProxyURL = "https://api.ttv.lol"
    @AppStorage("externalProxyURL") private var externalProxyURL = ""
    @AppStorage("externalProxyLastGood") private var externalProxyLastGood = ""
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @StateObject private var authManager = TwitchAuthManager.shared
    @StateObject private var updateManager = UpdateManager.shared
    @State private var showLoginSheet = false
    @State private var cacheSize: String = ""
    @State private var proxyTestResult: String?
    @State private var isTestingProxy = false
    @State private var fetchProxyResult: String?
    @State private var isFetchingProxy = false

    var body: some View {
        NavigationStack {
            Form {
                if updateManager.isUpdateAvailable, let release = updateManager.latestRelease {
                    Section {
                        Button(action: {
                            if let url = URL(string: release.htmlUrl) {
                                UIApplication.shared.open(url)
                            }
                        }) {
                            HStack(spacing: 12) {
                                Image(systemName: "arrow.triangle.2.circlepath.circle.fill")
                                    .font(.title2)
                                    .foregroundColor(.white)

                                VStack(alignment: .leading, spacing: 4) {
                                    Text(String(format: NSLocalizedString("A new version of NoSubVod is available on GitHub (NoSubVod v%@)! Click here to download it!", comment: ""), release.displayVersion))
                                        .font(.subheadline)
                                        .fontWeight(.semibold)
                                        .foregroundColor(.white)
                                        .multilineTextAlignment(.leading)
                                }

                                Spacer()

                                Image(systemName: "chevron.right")
                                    .font(.caption)
                                    .foregroundColor(.white.opacity(0.8))
                            }
                            .padding(.vertical, 4)
                        }
                        .listRowBackground(
                            LinearGradient(
                                colors: [Color.purple, Color(red: 0.5, green: 0.2, blue: 0.8)],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                    }
                }

                Section(header: Text("Twitch Account")) {
                    if authManager.isAuthenticated, let user = authManager.currentUser {
                        HStack(spacing: 12) {
                            if let url = user.profileImageURL {
                                AsyncImage(url: url) { image in
                                    image.resizable().aspectRatio(contentMode: .fill)
                                } placeholder: {
                                    Circle().fill(Color.gray.opacity(0.3))
                                }
                                .frame(width: 44, height: 44)
                                .clipShape(Circle())
                            }

                            VStack(alignment: .leading, spacing: 2) {
                                Text(user.displayName)
                                    .font(.headline)
                                Text("@\(user.login)")
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                            }
                        }
                        .padding(.vertical, 2)

                        Button("Sync Subs") {
                            syncFollows()
                        }

                        Button("Log Out", role: .destructive) {
                            authManager.logout()
                        }
                    } else {
                        Button("Sign in with Twitch") {
                            showLoginSheet = true
                        }

                        Text("Sign in to import your subscriptions into Your Subs and send messages in live chat.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Section(header: Text("App Preferences")) {
                    Picker("Language", selection: $appLanguage) {
                        Text("English").tag("en")
                        Text("Français").tag("fr")
                    }
                    
                    Picker("App Theme", selection: $appTheme) {
                        Text("System").tag("system")
                        Text("Dark").tag("dark")
                        Text("Light").tag("light")
                    }
                }
                
                Section(header: Text("Video Player")) {
                    Picker("Default Quality (Wi-Fi)", selection: $defaultVideoQuality) {
                        Text("Auto").tag("auto")
                        Text("1080p").tag("1080p")
                        Text("720p").tag("720p")
                        Text("480p").tag("480p")
                        Text("360p").tag("360p")
                        Text("160p").tag("160p")
                    }
                    
                    Picker("Default Quality (Cellular)", selection: $defaultVideoQualityCellular) {
                        Text("Auto").tag("auto")
                        Text("1080p").tag("1080p")
                        Text("720p").tag("720p")
                        Text("480p").tag("480p")
                        Text("360p").tag("360p")
                        Text("160p").tag("160p")
                    }
                }
                
                Section(header: Text("Ad Blocking")) {
                    Picker("Ad Block Mode", selection: $adBlockMode) {
                        ForEach(AdBlockMode.allCases, id: \.rawValue) { mode in
                            Text(mode.displayName).tag(mode.rawValue)
                        }
                    }

                    if adBlockMode == AdBlockMode.ttv.rawValue {
                        TextField("Proxy URL", text: $ttvProxyURL)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .keyboardType(.URL)

                        Text("Enter the URL of a TTV-compatible ad-blocking proxy.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    if adBlockMode == AdBlockMode.external.rawValue {
                        TextField("Proxy URL", text: $externalProxyURL)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .keyboardType(.URL)

                        Text("HTTP proxy (host:port) in an ad-free country — e.g. your own Squid. Leave empty to auto-fetch a free proxy from the ad-free country lists.")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        HStack {
                            Button("Test Proxy") {
                                testExternalProxy()
                            }
                            .disabled(isTestingProxy || isFetchingProxy)

                            if isTestingProxy {
                                ProgressView()
                                    .controlSize(.small)
                            } else if let proxyTestResult {
                                Text(proxyTestResult)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }

                        HStack {
                            Button("Fetch Free Proxy") {
                                fetchFreeProxy()
                            }
                            .disabled(isFetchingProxy || isTestingProxy)

                            if isFetchingProxy {
                                ProgressView()
                                    .controlSize(.small)
                            } else if let fetchProxyResult {
                                Text(fetchProxyResult)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }

                        if !externalProxyLastGood.isEmpty {
                            Text(String(format: NSLocalizedString("Last auto-discovered: %@", comment: ""), externalProxyLastGood))
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }

                    if let mode = AdBlockMode(rawValue: adBlockMode) {
                        Text(mode.shortDescription)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Section(header: Text("Downloads")) {
                    Picker("Network Preference", selection: $downloadNetworkPreference) {
                        Text("Wi-Fi + Cellular").tag("all")
                        Text("Wi-Fi Only").tag("wifi")
                    }
                    
                    Picker("Default Quality", selection: $defaultDownloadQuality) {
                        Text("Source").tag("chunked")
                        Text("1080p60").tag("1080p60")
                        Text("720p60").tag("720p60")
                        Text("480p30").tag("480p30")
                        Text("360p30").tag("360p30")
                        Text("160p30").tag("160p30")
                        Text("Audio Only").tag("audio_only")
                    }
                }
                
                Section(header: Text("LiveContainer")) {
                    Toggle("Compatible Storage", isOn: $isLiveContainerStorageEnabled)

                    if isLiveContainerStorageEnabled {
                        Text("Ensures data persistence when using LiveContainer. An app restart is required for changes to history and database to take effect.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                
                Section(header: Text("Debug")) {
                    Toggle("Enable debug mode", isOn: $isDebugModeEnabled)

                    if isDebugModeEnabled {
                        Text("Logs are streamed natively to system Console.app (subsystem: com.nosubvod)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                
                Section(header: Text("Cache")) {
                    HStack {
                        Text("Cache Size")
                        Spacer()
                        if cacheSize.isEmpty {
                            ProgressView()
                        } else {
                            Text(cacheSize)
                                .foregroundColor(.secondary)
                        }
                    }
                    Button(role: .destructive, action: {
                        ImageCache.shared.clearCache()
                        URLCache.shared.removeAllCachedResponses()
                        clearCachesDirectory()
                        calculateCacheSize()
                    }) {
                        Text("Clear Cache")
                    }
                }
                Section(header: Text("About")) {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.2.0")
                            .foregroundColor(.secondary)
                    }
                    HStack {
                        Text("Developer")
                        Spacer()
                        if let githubURL = URL(string: "https://github.com/Theorhd") {
                            Link("Theorhd", destination: githubURL)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .onAppear {
                calculateCacheSize()
                Task {
                    await updateManager.checkForUpdates()
                }
            }
            .sheet(isPresented: $showLoginSheet) {
                TwitchLoginSheet()
            }
        }
    }
    
    private func syncFollows() {
        Task {
            try? await authManager.syncFollows(into: modelContext)
        }
    }

    private func testExternalProxy() {
        guard let proxy = ExternalProxyService.parse(externalProxyURL) else {
            proxyTestResult = NSLocalizedString("Invalid proxy URL — use host:port", comment: "")
            return
        }
        proxyTestResult = nil
        isTestingProxy = true
        Task {
            let result = await ExternalProxyService.validate(proxy)
            let text: String
            switch result.status {
            case .ok(let countryCode):
                text = String(format: NSLocalizedString("✓ Ad-free country (%@)", comment: ""), countryCode)
            case .notAdFree(let countryCode):
                text = String(format: NSLocalizedString("✗ Country %@ still serves ads", comment: ""), countryCode)
            case .unreachable:
                text = NSLocalizedString("✗ Proxy unreachable", comment: "")
            }
            DispatchQueue.main.async {
                isTestingProxy = false
                proxyTestResult = text
            }
        }
    }

    /// Scrapes the ad-free country lists (spys.one MD/RU/EE/BG), validates
    /// the candidates end-to-end and stores the first working proxy — the
    /// same chain the player runs at playback when the URL field is empty.
    /// The result message reports the scrape count so a failure tells apart
    /// "lists unreachable" from "all candidates dead".
    private func fetchFreeProxy() {
        fetchProxyResult = nil
        isFetchingProxy = true
        Task {
            let candidates = await ProxyScraperService.fetchCandidates()
            let found = candidates.isEmpty ? nil : await ProxyScraperService.findFirstValid(candidates)
            await MainActor.run {
                isFetchingProxy = false
                if candidates.isEmpty {
                    fetchProxyResult = NSLocalizedString("✗ lists unreachable — no proxies scraped", comment: "")
                } else if let found {
                    externalProxyLastGood = "\(found.host):\(found.port)"
                    fetchProxyResult = String(format: NSLocalizedString("✓ %@", comment: ""), externalProxyLastGood)
                } else {
                    fetchProxyResult = String(format: NSLocalizedString("✗ no usable proxy found (%d scraped)", comment: ""), candidates.count)
                }
            }
        }
    }

    private func calculateCacheSize() {
        DispatchQueue.global(qos: .background).async {
            var totalSize: Int64 = 0
            
            if let cacheURL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first {
                if let enumerator = FileManager.default.enumerator(at: cacheURL, includingPropertiesForKeys: [.fileSizeKey]) {
                    for case let fileURL as URL in enumerator {
                        // Valeur optionnelle, nil prévu
                        if let fileSize = try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize {
                            totalSize += Int64(fileSize)
                        }
                    }
                }
            }
            
            let formatter = ByteCountFormatter()
            formatter.allowedUnits = [.useKB, .useMB, .useGB]
            formatter.countStyle = .file
            let sizeString = formatter.string(fromByteCount: totalSize)
            
            DispatchQueue.main.async {
                self.cacheSize = sizeString
            }
        }
    }
    
    private func clearCachesDirectory() {
        if let cacheURL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first {
            if let enumerator = FileManager.default.enumerator(at: cacheURL, includingPropertiesForKeys: nil) {
                for case let fileURL as URL in enumerator {
                    FileManager.default.removeItemIfExists(at: fileURL)
                }
            }
        }
    }
}
