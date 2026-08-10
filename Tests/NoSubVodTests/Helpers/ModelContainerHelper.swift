import Foundation
import SwiftData
@testable import NoSubVod

/// Helper to create an in-memory ModelContainer for testing SwiftData operations.
enum ModelContainerHelper {

    static func createTestContainer() -> ModelContainer {
        let schema = Schema([
            VODDownload.self,
            PersistentHistoryEntry.self,
            PersistentWatchlistEntry.self,
            PersistentSubscription.self,
        ])
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        // swiftlint:disable:next force_try
        return try! ModelContainer(for: schema, configurations: [config])
    }
}
