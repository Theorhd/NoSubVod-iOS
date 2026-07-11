import SwiftUI
import SwiftData

struct ChannelView: View {
    let login: String
    @StateObject private var viewModel: ChannelViewModel
    
    @Environment(\.modelContext) private var modelContext
    @Query private var subscriptions: [PersistentSubscription]
    
    init(login: String) {
        self.login = login
        _viewModel = StateObject(wrappedValue: ChannelViewModel(login: login))
        
        // Filter subscriptions for this login
        let predicateLogin = login
        _subscriptions = Query(filter: #Predicate<PersistentSubscription> { $0.login == predicateLogin })
    }
    
    var isSubscribed: Bool {
        !subscriptions.isEmpty
    }
    
    var body: some View {
        ScrollView {
            VStack {
                if let url = viewModel.profileImageURL {
                    AsyncImage(url: url) { image in
                        image.resizable().aspectRatio(contentMode: .fill)
                    } placeholder: {
                        Circle().fill(Color.gray.opacity(0.3))
                    }
                    .frame(width: 100, height: 100)
                    .clipShape(Circle())
                    .padding()
                } else {
                    Circle()
                        .fill(Color.gray.opacity(0.3))
                        .frame(width: 100, height: 100)
                        .padding()
                }
                
                Text(viewModel.displayName ?? login.capitalized)
                    .font(.title)
                    .bold()
                
                Divider()
                    .padding(.vertical)
                
                Text("Recent VODs")
                    .font(.headline)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal)
                
                if viewModel.isLoading {
                    ProgressView()
                        .padding()
                } else {
                    LazyVStack(spacing: 12) {
                        ForEach(viewModel.vods) { vod in
                            NavigationLink(destination: PlayerView(
                                videoID: vod.id,
                                isLive: false,
                                metadata: VideoMetadata(
                                    title: vod.title,
                                    viewerCount: nil,
                                    viewCount: vod.viewCount,
                                    streamerName: vod.owner?.displayName ?? "",
                                    streamerProfileURL: vod.owner?.profileImageURL,
                                    gameName: vod.game?.name,
                                    previewThumbnailURL: vod.previewThumbnailURL
                                )
                            )) {
                                HStack(alignment: .top, spacing: 12) {
                                    AsyncImage(url: vod.previewThumbnailURL) { image in
                                        image.resizable().aspectRatio(contentMode: .fill)
                                    } placeholder: {
                                        Color.gray
                                    }
                                    .frame(width: 140, height: 78)
                                    .cornerRadius(8)
                                    
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(vod.title)
                                            .font(.headline)
                                            .lineLimit(2)
                                            .multilineTextAlignment(.leading)
                                        Text("\(vod.viewCount) views • \(vod.lengthSeconds / 3600)h \((vod.lengthSeconds % 3600) / 60)m")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .padding(.horizontal)
                            }
                            .buttonStyle(PlainButtonStyle())
                        }
                    }
                }
            }
        }
        .navigationTitle(viewModel.displayName ?? login.capitalized)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: toggleSubscription) {
                    Image(systemName: isSubscribed ? "checkmark.circle.fill" : "plus.circle")
                }
            }
        }
        .onAppear {
            viewModel.loadVODs()
        }
    }
    
    private func toggleSubscription() {
        if let sub = subscriptions.first {
            modelContext.delete(sub)
        } else {
            let newSub = PersistentSubscription(
                login: login,
                displayName: viewModel.displayName ?? login.capitalized,
                profileImageURL: viewModel.profileImageURL
            )
            modelContext.insert(newSub)
        }
    }
}

@MainActor
class ChannelViewModel: ObservableObject {
    @Published var vods: [VOD] = []
    @Published var isLoading = false
    @Published var displayName: String?
    @Published var profileImageURL: URL?
    
    let login: String
    
    init(login: String) {
        self.login = login
    }
    
    func loadVODs() {
        guard vods.isEmpty else { return }
        isLoading = true
        
        Task {
            do {
                let results = try await TwitchAPIService.shared.fetchChannelVODs(login: login)
                DispatchQueue.main.async {
                    self.vods = results
                    if let owner = results.first?.owner {
                        self.displayName = owner.displayName
                        self.profileImageURL = owner.profileImageURL
                    }
                    self.isLoading = false
                }
            } catch {
                print("Erreur de chargement des VODs pour \\(login): \\(error)")
                DispatchQueue.main.async {
                    self.isLoading = false
                }
            }
        }
    }
}
