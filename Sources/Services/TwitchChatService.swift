import Foundation
import Combine

final class TwitchChatService: ObservableObject {
    private var webSocketTask: URLSessionWebSocketTask?
    @Published var messages: [ChatMessage] = []

    // Protège la boucle récursive receiveMessage() contre un appel
    // concurrent à disconnect() depuis MainActor.
    private var isConnected: Bool = false

    private let url: URL? = URL(string: "wss://irc-ws.chat.twitch.tv:443")

    func connect(channel: String) {
        messages.removeAll()
        guard let url else {
            AppLogger.shared.log("TwitchChatService: invalid websocket URL")
            return
        }
        isConnected = true

        let request = URLRequest(url: url)
        webSocketTask = URLSession.shared.webSocketTask(with: request)
        webSocketTask?.resume()

        let token = TwitchAuthManager.shared.accessToken ?? "SCHMOOPIIE"
        let nick = TwitchAuthManager.shared.currentUser?.login ?? "justinfan12345"

        sendMessage("CAP REQ :twitch.tv/membership twitch.tv/tags twitch.tv/commands")
        sendMessage("PASS oauth:\(token)")
        sendMessage("NICK \(nick)")
        sendMessage("JOIN #\(channel.lowercased())")

        receiveMessage()
    }

    func disconnect() {
        isConnected = false
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
    }

    private func sendMessage(_ message: String) {
        let messageToSend = URLSessionWebSocketTask.Message.string(message)
        webSocketTask?.send(messageToSend) { error in
            if let error = error {
                AppLogger.shared.log("Error sending message: \(error)")
            }
        }
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            guard let self, self.isConnected else { return }

            switch result {
            case .failure(let error):
                AppLogger.shared.log("Error in receiving message: \(error)")
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

    private func handleIRCMessage(_ rawMessage: String) {
        let lines = rawMessage.components(separatedBy: "\r\n")

        for line in lines where !line.isEmpty {
            if line.hasPrefix("PING") {
                sendMessage(line.replacingOccurrences(of: "PING", with: "PONG"))
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
