import SwiftUI
import SwiftData

struct HomeView: View {
    @StateObject private var viewModel = HomeViewModel()
    @Query private var history: [PersistentHistoryEntry]
    @Query(sort: \PersistentSubscription.addedAt, order: .reverse) private var subscriptions: [PersistentSubscription]
    @State private var showSettings = false
    
    var body: some View {
        NavigationStack {
            ScrollView {
                if viewModel.isLoading {
                    ProgressView()
                        .padding(.top, 50)
                } else {
                    VStack(alignment: .leading) {
                        if !subscriptions.isEmpty {
                            Text("Your Subs")
                                .font(.title2)
                                .bold()
                                .padding(.horizontal)
                            
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 16) {
                                    ForEach(subscriptions, id: \.login) { sub in
                                        NavigationLink(destination: ChannelView(login: sub.login)) {
                                            VStack {
                                                ZStack(alignment: .bottom) {
                                                    if let url = sub.profileImageURL {
                                                        CachedAsyncImage(url: url) { phase in
                                                            if let image = phase.image {
                                                                image.resizable().aspectRatio(contentMode: .fill)
                                                            } else {
                                                                Circle().fill(Color.gray.opacity(0.3))
                                                            }
                                                        }
                                                        .frame(width: 60, height: 60)
                                                        .clipShape(Circle())
                                                    } else {
                                                        Circle()
                                                            .fill(Color.gray.opacity(0.3))
                                                            .frame(width: 60, height: 60)
                                                    }
                                                    
                                                    if viewModel.liveSubscriptions.contains(sub.login.lowercased()) {
                                                        Text("LIVE")
                                                            .font(.system(size: 10, weight: .bold))
                                                            .foregroundColor(.white)
                                                            .padding(.horizontal, 4)
                                                            .padding(.vertical, 2)
                                                            .background(Color.red)
                                                            .cornerRadius(4)
                                                            .offset(y: 8)
                                                            .overlay(
                                                                RoundedRectangle(cornerRadius: 4)
                                                                    .stroke(Color(.systemBackground), lineWidth: 1.5)
                                                                    .offset(y: 8)
                                                            )
                                                    }
                                                }
                                                .padding(.bottom, viewModel.liveSubscriptions.contains(sub.login.lowercased()) ? 8 : 0)
                                                
                                                Text(sub.displayName)
                                                    .font(.caption)
                                                    .lineLimit(1)
                                                    .foregroundColor(.primary)
                                            }
                                            .frame(width: 70)
                                        }
                                    }
                                }
                                .padding(.horizontal)
                            }
                            .padding(.bottom, 8)
                        }
                        
                        Text("Live Streams")
                            .font(.title2)
                            .bold()
                            .padding(.horizontal)
                        
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 16) {
                                ForEach(viewModel.liveStreams) { stream in
                                    NavigationLink(destination: PlayerView(
                                        videoID: stream.broadcaster.login,
                                        isLive: true,
                                        metadata: VideoMetadata(
                                            title: stream.title,
                                            viewerCount: stream.viewerCount,
                                            viewCount: nil,
                                            streamerName: stream.broadcaster.displayName,
                                            streamerProfileURL: stream.broadcaster.profileImageURL,
                                            gameName: stream.game?.name,
                                            previewThumbnailURL: stream.previewImageURL
                                        )
                                    )) {
                                        VStack(alignment: .leading) {
                                            CachedAsyncImage(url: stream.previewImageURL) { phase in
                                                if let image = phase.image {
                                                    image.resizable().aspectRatio(contentMode: .fill)
                                                } else if phase.error != nil {
                                                    Color.gray.opacity(0.3)
                                                        .overlay(Image(systemName: "photo").foregroundColor(.gray))
                                                } else {
                                                    Color.gray.opacity(0.3)
                                                }
                                            }
                                            .frame(width: 250, height: 140)
                                            .cornerRadius(12)
                                            
                                            Text(stream.broadcaster.displayName)
                                                .font(.headline)
                                            Text(stream.title)
                                                .font(.subheadline)
                                                .lineLimit(1)
                                                .foregroundColor(.secondary)
                                        }
                                        .frame(width: 250)
                                    }
                                    .buttonStyle(PlainButtonStyle())
                                }
                            }
                            .padding(.horizontal)
                        }
                        
                        Text("Trending VODs")
                            .font(.title2)
                            .bold()
                            .padding(.horizontal)
                            .padding(.top)
                        
                        VStack(spacing: 16) {
                            ForEach(viewModel.trendingVODs) { vod in
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
                                    HStack {
                                        CachedAsyncImage(url: vod.previewThumbnailURL) { phase in
                                            if let image = phase.image {
                                                image.resizable().aspectRatio(contentMode: .fill)
                                            } else if phase.error != nil {
                                                Color.gray.opacity(0.3)
                                                    .overlay(Image(systemName: "photo").foregroundColor(.gray))
                                            } else {
                                                Color.gray.opacity(0.3)
                                            }
                                        }
                                        .frame(width: 160, height: 90)
                                        .cornerRadius(8)
                                        
                                        VStack(alignment: .leading) {
                                            Text(vod.title)
                                                .font(.headline)
                                                .lineLimit(2)
                                            Text(vod.owner?.displayName ?? "")
                                                .font(.subheadline)
                                                .foregroundColor(.secondary)
                                        }
                                        Spacer()
                                    }
                                    .padding(.horizontal)
                                }
                                .buttonStyle(PlainButtonStyle())
                            }
                        }
                    }
                    .padding(.vertical)
                }
            }
            .navigationTitle("NoSubVod")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {
                        showSettings = true
                    }) {
                        Image(systemName: "gearshape")
                            .foregroundColor(.primary)
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .task(id: subscriptions) {
                await viewModel.loadData(history: history, subs: subscriptions)
            }
        }
    }
}
