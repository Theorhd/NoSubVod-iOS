import Foundation
import Combine

class TwitchChatService: ObservableObject {
    private var webSocketTask: URLSessionWebSocketTask?
    @Published var messages: [ChatMessage] = []
    
    private let url = URL(string: "wss://irc-ws.chat.twitch.tv:443")!
    
    func connect(channel: String) {
        messages.removeAll()
        
        let request = URLRequest(url: url)
        webSocketTask = URLSession.shared.webSocketTask(with: request)
        webSocketTask?.resume()
        
        // Pass credentials - using an anonymous connection for now
        let token = TwitchAuthManager.shared.accessToken ?? "SCHMOOPIIE"
        let nick = TwitchAuthManager.shared.currentUser?.login ?? "justinfan12345"
        
        let passCommand = "PASS oauth:\(token)"
        let nickCommand = "NICK \(nick)"
        let joinCommand = "JOIN #\(channel.lowercased())"
        
        sendMessage(passCommand)
        sendMessage(nickCommand)
        sendMessage(joinCommand)
        
        receiveMessage()
    }
    
    func disconnect() {
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
    }
    
    private func sendMessage(_ message: String) {
        let messageToSend = URLSessionWebSocketTask.Message.string(message)
        webSocketTask?.send(messageToSend) { error in
            if let error = error {
                print("Error sending message: \(error)")
            }
        }
    }
    
    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            guard let self = self else { return }
            
            switch result {
            case .failure(let error):
                print("Error in receiving message: \(error)")
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
                
                // Continue listening
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
            
            // Basic parsing of PRIVMSG for MVP
            // Format: :user!user@user.tmi.twitch.tv PRIVMSG #channel :message
            if line.contains("PRIVMSG") {
                let parts = line.components(separatedBy: " PRIVMSG ")
                if parts.count == 2 {
                    let userPart = parts[0]
                    let messagePart = parts[1]
                    
                    let userLogin = userPart.components(separatedBy: "!")[0].replacingOccurrences(of: ":", with: "")
                    
                    let messageContentParts = messagePart.components(separatedBy: " :")
                    if messageContentParts.count == 2 {
                        let text = messageContentParts[1]
                        
                        let commenter = ChatCommenter(displayName: userLogin, login: userLogin, profileImageURL: nil)
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
        }
    }
}
