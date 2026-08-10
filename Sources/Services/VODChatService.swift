import Foundation
import Combine

final class VODChatService: ObservableObject {
    @Published var messages: [ChatMessage] = []
    
    private let videoID: String
    private var nextCursor: String?
    private var isFetching = false
    
    init(videoID: String) {
        self.videoID = videoID
    }
    
    func fetchChat(at offsetSeconds: Double) {
        guard !isFetching else { return }
        isFetching = true
        
        let gql = """
        query VideoCommentsByOffsetOrCursor($videoID: ID!, $contentOffsetSeconds: Int) {
          video(id: $videoID) {
            comments(contentOffsetSeconds: $contentOffsetSeconds) {
              edges {
                node {
                  id
                  commenter {
                    login
                    displayName
                  }
                  message {
                    fragments {
                      text
                    }
                  }
                  contentOffsetSeconds
                  createdAt
                }
              }
            }
          }
        }
        """
        
        Task {
            do {
                let variables: [String: Any] = [
                    "videoID": videoID,
                    "contentOffsetSeconds": Int(offsetSeconds)
                ]
                let data = try await TwitchAPIService.shared.executeGQLQuery(query: gql, variables: variables)
                
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let dataDict = json["data"] as? [String: Any],
                   let videoDict = dataDict["video"] as? [String: Any],
                   let commentsDict = videoDict["comments"] as? [String: Any],
                   let edges = commentsDict["edges"] as? [[String: Any]] {
                    
                    var newMessages: [ChatMessage] = []
                    
                    for edge in edges {
                        guard let node = edge["node"] as? [String: Any],
                              let id = node["id"] as? String,
                              let commenter = node["commenter"] as? [String: Any],
                              let login = commenter["login"] as? String,
                              let displayName = commenter["displayName"] as? String,
                              let messageDict = node["message"] as? [String: Any],
                              let fragmentsDicts = messageDict["fragments"] as? [[String: Any]],
                              let contentOffsetSeconds = node["contentOffsetSeconds"] as? Int else {
                            continue
                        }
                        
                        var text = ""
                        for frag in fragmentsDicts {
                            if let fText = frag["text"] as? String {
                                text += fText
                            }
                        }
                        
                        let chatCommenter = ChatCommenter(displayName: displayName, login: login, profileImageURL: nil)
                        let fragment = ChatFragment(text: text, emote: nil)
                        let chatContent = ChatMessageContent(fragments: [fragment])
                        
                        let chatMessage = ChatMessage(
                            id: id,
                            commenter: chatCommenter,
                            message: chatContent,
                            contentOffsetSeconds: contentOffsetSeconds,
                            createdAt: Date()
                        )
                        newMessages.append(chatMessage)
                    }
                    
                    let capturedMessages = newMessages
                    
                    await MainActor.run {

                        let existingIds = Set(self.messages.map { $0.id })
                        let uniqueNew = capturedMessages.filter { !existingIds.contains($0.id) }
                        
                        self.messages.append(contentsOf: uniqueNew)
                        self.messages.sort(by: { $0.contentOffsetSeconds < $1.contentOffsetSeconds })
                        

                        if self.messages.count > 100 {
                            self.messages.removeFirst(self.messages.count - 100)
                        }
                        
                        self.isFetching = false
                    }
                } else {
                    await MainActor.run { self.isFetching = false }
                }
            } catch {
                print("Failed to fetch VOD chat: \(error)")
                await MainActor.run { self.isFetching = false }
            }
        }
    }
}
