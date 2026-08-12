import SwiftUI
import SwiftData

/// Sheet de connexion Twitch réutilisable (réglages, chat…).
///
/// Charge l'URL d'autorisation dans une WKWebView, intercepte la redirection
/// OAuth, finalise l'échange de code (PKCE) et synchronise les suivis.
struct TwitchLoginSheet: View {
    /// Appelé après connexion réussie (ex. : reconnecter le chat avec le compte).
    var onLoggedIn: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @StateObject private var authManager = TwitchAuthManager.shared
    @State private var session: TwitchAuthManager.TwitchLoginSession?
    @State private var showError = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                if let session {
                    TwitchLoginWebView(authURL: session.authURL, redirectURI: redirectURI) { callbackURL in
                        dismiss()
                        Task { await completeLogin(callbackURL: callbackURL, session: session) }
                    }
                } else if errorMessage != nil {
                    failureView
                } else {
                    ProgressView("Préparation de la connexion…")
                }
            }
            .navigationTitle("Connexion Twitch")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
            }
        }
        .onAppear {
            do {
                let newSession = try authManager.beginLogin()
                session = newSession
                TwitchAuthDebug.log("beginLogin OK — \(newSession.authURL)")
            } catch {
                TwitchAuthDebug.log("beginLogin échoué: \(error)")
                errorMessage = "Connexion impossible : \(error)"
            }
        }
        .alert("Connexion échouée", isPresented: $showError) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var redirectURI: URL {
        URL(string: AppSecrets.twitchRedirectURI) ?? URL(string: "http://localhost/oauth/callback")!
    }

    private var failureView: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundColor(.orange)
            Text(errorMessage ?? "Erreur inconnue")
                .multilineTextAlignment(.center)
            Button("Réessayer") {
                errorMessage = nil
                session = try? authManager.beginLogin()
            }
        }
        .padding()
    }

    private func completeLogin(callbackURL: URL, session: TwitchAuthManager.TwitchLoginSession) async {
        TwitchAuthDebug.log("callback reçu: \(callbackURL.absoluteString)")
        do {
            try await authManager.completeLogin(callbackURL: callbackURL, session: session)
            TwitchAuthDebug.log("login réussi — sync des suivis…")
            try? await authManager.syncFollows(into: modelContext)
            TwitchAuthDebug.log("sync terminé")
            onLoggedIn?()
        } catch {
            TwitchAuthDebug.log("login échoué: \(error)")
            errorMessage = "\(error)"
            showError = true
        }
    }
}
