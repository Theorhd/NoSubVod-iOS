import SwiftUI

struct SettingsView: View {
    @AppStorage("defaultVideoQuality") private var defaultVideoQuality = "auto"
    @AppStorage("isDebugModeEnabled") private var isDebugModeEnabled = false
    @AppStorage("isLiveContainerStorageEnabled") private var isLiveContainerStorageEnabled = false
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("Video Player")) {
                    Picker("Default Quality", selection: $defaultVideoQuality) {
                        Text("Auto").tag("auto")
                        Text("1080p").tag("1080p")
                        Text("720p").tag("720p")
                        Text("480p").tag("480p")
                        Text("360p").tag("360p")
                        Text("160p").tag("160p")
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
                        Text("NoSubVod")
                            .foregroundColor(.secondary)
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
        }
    }
}
