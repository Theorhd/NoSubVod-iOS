import SwiftUI

class ImageCache {
    static let shared = ImageCache()
    
    private let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 100
        cache.totalCostLimit = 1024 * 1024 * 100 // 100 MB
        return cache
    }()
    
    func set(_ image: UIImage, forKey key: String) {
        cache.setObject(image, forKey: key as NSString)
    }
    
    func get(forKey key: String) -> UIImage? {
        return cache.object(forKey: key as NSString)
    }
}

class CachedImageLoader: ObservableObject {
    @Published var phase: AsyncImagePhase = .empty
    private let urlString: String
    private var isLoading = false
    
    init(url: URL?) {
        self.urlString = url?.absoluteString ?? ""
        if let url = url {
            loadImage(from: url)
        }
    }
    
    private func loadImage(from url: URL) {
        if let cachedImage = ImageCache.shared.get(forKey: url.absoluteString) {
            self.phase = .success(Image(uiImage: cachedImage))
            return
        }
        
        guard !isLoading else { return }
        isLoading = true
        
        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                if let uiImage = UIImage(data: data) {
                    ImageCache.shared.set(uiImage, forKey: url.absoluteString)
                    await MainActor.run {
                        self.phase = .success(Image(uiImage: uiImage))
                        self.isLoading = false
                    }
                } else {
                    throw URLError(.badServerResponse)
                }
            } catch {
                await MainActor.run {
                    self.phase = .failure(error)
                    self.isLoading = false
                }
            }
        }
    }
}

public struct CachedAsyncImage<Content: View>: View {
    @StateObject private var loader: CachedImageLoader
    private let content: (AsyncImagePhase) -> Content
    
    public init(
        url: URL?,
        @ViewBuilder content: @escaping (AsyncImagePhase) -> Content
    ) {
        _loader = StateObject(wrappedValue: CachedImageLoader(url: url))
        self.content = content
    }
    
    public var body: some View {
        content(loader.phase)
    }
}

public extension CachedAsyncImage {
    init<I: View, P: View>(
        url: URL?,
        @ViewBuilder content: @escaping (Image) -> I,
        @ViewBuilder placeholder: @escaping () -> P
    ) where Content == AnyView {
        self.init(url: url) { phase in
            if let image = phase.image {
                return AnyView(content(image))
            } else {
                return AnyView(placeholder())
            }
        }
    }
}
