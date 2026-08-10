import Foundation
import Combine

final class DownloadManager: NSObject, ObservableObject, URLSessionDownloadDelegate {
    static let shared = DownloadManager()
    
    @Published var activeDownloads: [String: Double] = [:]
    
    private lazy var urlSession: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "com.theorhd.NoSubVod.BackgroundSession")
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    
    private override init() {
        super.init()
    }
    
    func download(url: URL) {
        let task = urlSession.downloadTask(with: url)
        task.resume()
        
        DispatchQueue.main.async {
            self.activeDownloads[url.absoluteString] = 0.0
        }
    }
    
    
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let sourceURL = downloadTask.originalRequest?.url else { return }
        
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let destinationURL = documentsPath.appendingPathComponent(sourceURL.lastPathComponent)
        
        do {
            if FileManager.default.fileExists(atPath: destinationURL.path) {
                try FileManager.default.removeItem(at: destinationURL)
            }
            try FileManager.default.moveItem(at: location, to: destinationURL)
            print("Successfully downloaded to: \\(destinationURL.path)")
            
            DispatchQueue.main.async {
                self.activeDownloads.removeValue(forKey: sourceURL.absoluteString)
            }
        } catch {
            print("File move error: \\(error)")
        }
    }
    
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let sourceURL = downloadTask.originalRequest?.url, totalBytesExpectedToWrite > 0 else { return }
        
        let progress = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
        
        DispatchQueue.main.async {
            self.activeDownloads[sourceURL.absoluteString] = progress
        }
    }
}
