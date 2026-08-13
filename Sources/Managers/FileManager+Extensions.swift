import Foundation

extension FileManager {
    /// Documents directory de l'app (premier élément du user domain mask).
    static var documentsDirectory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    /// Suppression best-effort : fichier absent ignoré, erreur réelle loggée.
    /// Le nettoyage ne doit jamais casser le flux qui l'appelle.
    func removeItemIfExists(at url: URL) {
        guard fileExists(atPath: url.path) else { return }
        do {
            try removeItem(at: url)
        } catch {
            AppLogger.shared.log("FileManager: failed to remove \(url.lastPathComponent) — \(error)")
        }
    }
}
