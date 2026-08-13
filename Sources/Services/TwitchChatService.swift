import Foundation
import Combine
import os

@MainActor
final class TwitchChatService: ObservableObject {
    private var webSocketTask: URLSessionWebSocketTask?
    @Published var messages: [ChatMessage] = []
    /// Erreur d'envoi (NOTICE serveur : slow mode, message bloqué, non connecté…).
    @Published var lastSendError: String?

    private var channel: String?

    // Protège la boucle récursive receiveMessage() contre un appel
    // concurrent à disconnect() depuis MainActor.
    private var isConnected: Bool = false

    private let url: URL? = URL(string: "wss://irc-ws.chat.twitch.tv:443")

    func connect(channel: String) {
        messages.removeAll()
        lastSendError = nil
        guard let url else {
            Logger.network.error("TwitchChatService: invalid websocket URL")
            return
        }
        self.channel = channel.lowercased()
        isConnected = true

        let request = URLRequest(url: url)
        webSocketTask = URLSession.shared.webSocketTask(with: request)
        webSocketTask?.resume()

        let token = TwitchAuthManager.shared.accessToken ?? "SCHMOOPIIE"
        let nick = TwitchAuthManager.shared.currentUser?.login ?? "justinfan12345"

        sendMessage("CAP REQ :twitch.tv/membership twitch.tv/tags twitch.tv/commands")
        sendMessage("PASS oauth:\(token)")
        sendMessage("NICK \(nick)")
        sendMessage("JOIN #\(self.channel ?? channel.lowercased())")

        receiveMessage()
    }

    func disconnect() {
        isConnected = false
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
    }

    /// Envoie un message chat. Nécessite un compte connecté (IRC refuse les
    /// pseudos anonymes). Le serveur renvoie notre propre message → rendu par
    /// le handler PRIVMSG existant, pas d'append manuel.
    func sendChatMessage(_ text: String) -> Bool {
        let sanitized = Self.sanitizeMessage(text)
        guard !sanitized.isEmpty else { return false }

        guard TwitchAuthManager.shared.accessToken != nil else {
            setSendError("Connecte-toi pour envoyer un message")
            return false
        }
        guard let channel else {
            setSendError("Chat non connecté")
            return false
        }

        sendMessage(Self.privmsgPayload(channel: channel, text: sanitized))
        return true
    }

    /// Nettoie un message avant envoi : trim, lignes multiples → espaces, max 500 chars.
    nonisolated static func sanitizeMessage(_ text: String) -> String {
        let cleaned = text
            .replacingOccurrences(of: "\r\n", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
        let trimmed = cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
        return String(trimmed.prefix(500))
    }

    /// Payload IRC d'un message : `PRIVMSG #channel :texte`.
    nonisolated static func privmsgPayload(channel: String, text: String) -> String {
        "PRIVMSG #\(channel.lowercased()) :\(text)"
    }

    /// Extrait le texte d'une NOTICE serveur (`:tmi.twitch.tv NOTICE #chan :msg`),
    /// nil si la ligne n'est pas une NOTICE exploitable.
    nonisolated static func parseNotice(_ line: String) -> String? {
        let parts = line.components(separatedBy: " NOTICE ")
        guard parts.count == 2 else { return nil }
        let split = parts[1].components(separatedBy: " :")
        guard split.count >= 2 else { return nil }
        return split.dropFirst().joined(separator: " :")
    }

    private func sendMessage(_ message: String) {
        let messageToSend = URLSessionWebSocketTask.Message.string(message)
        webSocketTask?.send(messageToSend) { error in
            if let error = error {
                Logger.network.error("TwitchChatService error sending message: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    private func setSendError(_ message: String) {
        self.lastSendError = message
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.isConnected else { return }

                switch result {
                case .failure(let error):
                    Logger.network.error("TwitchChatService error receiving message: \(error.localizedDescription, privacy: .public)")
                case .success(let message):
                    switch message {
                    case .string(let text):
                        self.handleIRCMessage(text)
                    case .data(let data):
                        if let text = String(data: data, encoding: .utf8) {
                            self.handleIRCMessage(text)
                        }
                    @unknown default:
                        break
                    }

                    self.receiveMessage()
                }
            }
        }
    }

    private func handleIRCMessage(_ rawMessage: String) {
        let lines = rawMessage.components(separatedBy: "\r\n")

        for line in lines where !line.isEmpty {
            if line.hasPrefix("PING") {
                sendMessage(line.replacingOccurrences(of: "PING", with: "PONG"))
                continue
            }

            // NOTICE serveur → erreur d'envoi (slow mode, message bloqué…)
            if line.contains(" NOTICE ") {
                if let notice = Self.parseNotice(line) {
                    Logger.network.info("TwitchChatService NOTICE: \(notice, privacy: .public)")
                    setSendError(notice)
                }
                continue
            }

            // Parsing du message avec support des IRCv3 tags (préfixe "@key=value;...")
            // Exemple: @color=#FF0000;display-name=User PRIVMSG #channel :message
            guard line.contains("PRIVMSG") else { continue }

            var tagDict: [String: String] = [:]
            var remainder = line

            if remainder.hasPrefix("@") {
                let parts = remainder.dropFirst().components(separatedBy: " ")
                if parts.count >= 2 {
                    let tagsPart = parts[0]
                    remainder = parts.dropFirst().joined(separator: " ")
                    for tag in tagsPart.components(separatedBy: ";") {
                        let kv = tag.components(separatedBy: "=")
                        if kv.count == 2 { tagDict[kv[0]] = kv[1] }
                    }
                }
            }

            let parts = remainder.components(separatedBy: " PRIVMSG ")
            guard parts.count == 2 else { continue }

            let userPart = parts[0]
            let messagePart = parts[1]

            let userLogin = userPart.components(separatedBy: "!")[0].replacingOccurrences(of: ":", with: "")
            let displayName = tagDict["display-name"] ?? userLogin
            let colorHex = tagDict["color"].flatMap { $0.isEmpty ? nil : $0 }

            let messageContentParts = messagePart.components(separatedBy: " :")
            guard messageContentParts.count >= 2 else { continue }
            let text = messageContentParts.dropFirst().joined(separator: " :")

            let commenter = ChatCommenter(displayName: displayName, login: userLogin, profileImageURL: nil, colorHex: colorHex)
            let fragment = ChatFragment(text: text, emote: nil)
            let content = ChatMessageContent(fragments: [fragment])
            let chatMessage = ChatMessage(id: UUID().uuidString, commenter: commenter, message: content, contentOffsetSeconds: 0, createdAt: Date())

            DispatchQueue.main.async {
                self.messages.append(chatMessage)
                if self.messages.count > 100 {
                    self.messages.removeFirst()
                }
            }
        }
    }
}
