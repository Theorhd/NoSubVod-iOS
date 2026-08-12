import Foundation
import Security

/// Stockage abstrait de secrets — Keychain en production, mémoire en test.
protocol TokenStore {
    func save(_ value: String, for key: String)
    func read(for key: String) -> String?
    func delete(for key: String)
}

/// Stockage Keychain (kSecClassGenericPassword), service dédié à l'app.
final class KeychainTokenStore: TokenStore {
    static let shared = KeychainTokenStore()

    private let service = "com.theorhd.NoSubVod.tokens"

    private init() {}

    func save(_ value: String, for key: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]

        let attributes: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query
            insert[kSecValueData as String] = data
            SecItemAdd(insert as CFDictionary, nil)
        }
    }

    func read(for key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    func delete(for key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

/// Stockage en mémoire — tests uniquement.
final class InMemoryTokenStore: TokenStore {
    private var storage: [String: String] = [:]

    func save(_ value: String, for key: String) {
        storage[key] = value
    }

    func read(for key: String) -> String? {
        storage[key]
    }

    func delete(for key: String) {
        storage.removeValue(forKey: key)
    }
}
