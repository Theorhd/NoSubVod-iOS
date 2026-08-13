import Foundation
import Network
import Combine

final class NetworkMonitor: ObservableObject, @unchecked Sendable {
    static let shared = NetworkMonitor()
    
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "NetworkMonitorQueue")
    
    @Published private(set) var isCellular: Bool = false
    @Published private(set) var isConnected: Bool = false
    
    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                self?.isConnected = path.status == .satisfied
                self?.isCellular = path.usesInterfaceType(.cellular)
            }
        }
        monitor.start(queue: queue)
    }
}
