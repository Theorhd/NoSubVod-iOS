import SwiftUI

struct SettingsView: View {
    @AppStorage("defaultVideoQuality") private var defaultVideoQuality = "auto"
    @AppStorage("defaultVideoQualityCellular") private var defaultVideoQualityCellular = "auto"
    @AppStorage("defaultDownloadQuality") private var defaultDownloadQuality = "chunked"
    @AppStorage("downloadNetworkPreference") private var downloadNetworkPreference = "all"
    @AppStorage("appTheme") private var appTheme = "system"
    @AppStorage("appLanguage") private var appLanguage = "en"
    @AppStorage("isDebugModeEnabled") private var isDebugModeEnabled = false
    @AppStorage("isLiveContainerStorageEnabled") private var isLiveContainerStorageEnabled = false
    @Environment(\.dismiss) private var dismiss
    @State private var cacheSize: String = ""
    
    var body: some View {
        NavigationStack {
            Form {
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
                    Toggle("Stockage Compatible", isOn: $isLiveContainerStorageEnabled)
                    
                    if isLiveContainerStorageEnabled {
                        Text("Assure la persistance des données lors de l'utilisation via LiveContainer. Un redémarrage de l'application est nécessaire pour que les changements sur l'historique et la base de données prennent effet.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                
                Section(header: Text("Debug")) {
                    Toggle("Activer le mode debug", isOn: $isDebugModeEnabled)
                    
                    if isDebugModeEnabled {
                        ShareLink(item: AppLogger.shared.getLogFileURL()) {
                            Text("Exporter les logs")
                        }
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
                        Text("1.0.0")
                            .foregroundColor(.secondary)
                    }
                    HStack {
                        Text("Developer")
                        Spacer()
                        Link("Theorhd", destination: URL(string: "https://github.com/Theorhd")!)
                            .foregroundColor(.secondary)
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
            }
        }
    }
    
    private func calculateCacheSize() {
        DispatchQueue.global(qos: .background).async {
            var totalSize: Int64 = 0
            
            if let cacheURL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first {
                if let enumerator = FileManager.default.enumerator(at: cacheURL, includingPropertiesForKeys: [.fileSizeKey]) {
                    for case let fileURL as URL in enumerator {
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
                    try? FileManager.default.removeItem(at: fileURL)
                }
            }
        }
    }
}
