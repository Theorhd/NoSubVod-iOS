import SwiftUI

class ImageCache {
    static let shared = ImageCache()

    private let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 150
        cache.totalCostLimit = 50 * 1024 * 1024  // 50 Mo — plafond conservateur pour iOS
        return cache
    }()

    func set(_ image: UIImage, forKey key: String) {
        // Passer le coût réel (pixels × 4 bytes/px) pour que NSCache évicte les grandes images en premier.
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale) * 4
        cache.setObject(image, forKey: key as NSString, cost: cost)
    }

    func get(forKey key: String) -> UIImage? {
        return cache.object(forKey: key as NSString)
    }
}

@MainActor
class CachedImageLoader: ObservableObject {
    @Published var phase: AsyncImagePhase = .empty
    let url: URL?
    private var isLoading = false
    
    init(url: URL?) {
        self.url = url
    }
    
    func load() async {
        guard let url = url else { return }
        
        if let cachedImage = ImageCache.shared.get(forKey: url.absoluteString) {
            self.phase = .success(Image(uiImage: cachedImage))
            return
        }
        
        guard !isLoading else { return }
        isLoading = true
        
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            if let uiImage = UIImage(data: data) {
                ImageCache.shared.set(uiImage, forKey: url.absoluteString)
                self.phase = .success(Image(uiImage: uiImage))
            } else {
                throw URLError(.badServerResponse)
            }
        } catch {
            if !(error is CancellationError) {
                self.phase = .failure(error)
            }
        }
        self.isLoading = false
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
            .task(id: loader.url) {
                await loader.load()
            }
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
