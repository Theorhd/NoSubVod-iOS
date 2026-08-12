import SwiftUI
import WebKit

/// WebView OAuth Twitch.
///
/// Twitch n'accepte que des redirect URIs `https://…` ou `http://localhost…`
/// (pas d'URL scheme custom), et `ASWebAuthenticationSession` ne peut pas
/// joindre localhost (timeouts système). On charge donc l'URL d'autorisation
/// dans une WKWebView classique et on **intercepte la redirection** vers le
/// redirect URI dans `decidePolicyFor` — avant qu'aucune connexion réseau ne
/// parte. Le `code`/`state` sont extraits de l'URL, la navigation est annulée.
struct TwitchLoginWebView: UIViewRepresentable {
    let authURL: URL
    /// URI de redirection enregistrée dans la console Twitch (host + path).
    let redirectURI: URL
    /// Appelé avec l'URL de callback interceptée (code + state).
    let onCallback: (URL) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Stockage éphémère : aucun cookie/session Twitch n'est conservé entre
        // deux tentatives. Sans ça, une session résiduelle fait rediriger
        // Twitch automatiquement (page d'erreur) au lieu d'afficher le
        // formulaire de connexion — l'utilisateur ne peut plus se reloger.
        config.websiteDataStore = .nonPersistent()

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: authURL))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let parent: TwitchLoginWebView

        init(_ parent: TwitchLoginWebView) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            let isCallback = isCallbackURL(url)
            TwitchAuthDebug.log("nav: \(url.absoluteString) (callback=\(isCallback), mainFrame=\(navigationAction.targetFrame?.isMainFrame ?? false))")

            // Redirection OAuth vers localhost → callback capturé ici.
            if isCallback {
                TwitchAuthDebug.log("callback intercepté: \(url.absoluteString)")
                parent.onCallback(url)
                decisionHandler(.cancel)
                return
            }

            // On ne laisse naviguer que http(s) — rien d'autre (app links…).
            if url.scheme == "http" || url.scheme == "https" {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            TwitchAuthDebug.log("navigation échouée (provisoire): \(error.localizedDescription)")
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            TwitchAuthDebug.log("navigation échouée: \(error.localizedDescription)")
        }

        /// L'URL correspond au redirect URI : host localhost/127.0.0.1 + même chemin.
        /// Tolérant sur le port (Twitch peut normaliser l'URL de redirection).
        private func isCallbackURL(_ url: URL) -> Bool {
            guard let host = url.host else { return false }
            guard host == "localhost" || host == "127.0.0.1" else { return false }
            return url.path.hasPrefix(parent.redirectURI.path)
        }
    }
}
