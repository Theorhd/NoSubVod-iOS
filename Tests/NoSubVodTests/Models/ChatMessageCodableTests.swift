import XCTest
@testable import NoSubVod

final class ChatMessageCodableTests: XCTestCase {

    func testChatMessage_encodeDecode_roundTrip() throws {
        let message = ChatMessage(
            id: "msg-123",
            commenter: ChatCommenter(
                displayName: "Viewer1",
                login: "viewer1",
                profileImageURL: nil,
                colorHex: "#FF0000"
            ),
            message: ChatMessageContent(fragments: [
                ChatFragment(text: "Hello ", emote: nil),
                ChatFragment(text: "Kappa", emote: ChatEmote(id: "25")),
            ]),
            contentOffsetSeconds: 120,
            createdAt: Date(timeIntervalSince1970: 1718000000)
        )

        let data = try JSONEncoder().encode(message)
        let decoded = try JSONDecoder().decode(ChatMessage.self, from: data)

        XCTAssertEqual(decoded.id, "msg-123")
        XCTAssertEqual(decoded.commenter.displayName, "Viewer1")
        XCTAssertEqual(decoded.commenter.colorHex, "#FF0000")
        XCTAssertEqual(decoded.message.fragments.count, 2)
        XCTAssertEqual(decoded.message.fragments[0].text, "Hello ")
        XCTAssertEqual(decoded.message.fragments[1].emote?.id, "25")
        XCTAssertEqual(decoded.contentOffsetSeconds, 120)
    }

    func testChatCommenter_withoutColorHex() throws {
        let commenter = ChatCommenter(
            displayName: "NoColor",
            login: "nocolor",
            profileImageURL: URL(string: "https://example.com/pic.jpg")
        )

        let data = try JSONEncoder().encode(commenter)
        let decoded = try JSONDecoder().decode(ChatCommenter.self, from: data)

        XCTAssertEqual(decoded.displayName, "NoColor")
        XCTAssertNil(decoded.colorHex)
        XCTAssertEqual(decoded.profileImageURL, URL(string: "https://example.com/pic.jpg"))
    }

    func testChatFragment_withEmote() throws {
        let fragment = ChatFragment(text: "Kappa", emote: ChatEmote(id: "25"))

        let data = try JSONEncoder().encode(fragment)
        let decoded = try JSONDecoder().decode(ChatFragment.self, from: data)

        XCTAssertEqual(decoded.text, "Kappa")
        XCTAssertEqual(decoded.emote?.id, "25")
    }

    func testChatFragment_textOnly() throws {
        let fragment = ChatFragment(text: "Hello world", emote: nil)

        let data = try JSONEncoder().encode(fragment)
        let decoded = try JSONDecoder().decode(ChatFragment.self, from: data)

        XCTAssertEqual(decoded.text, "Hello world")
        XCTAssertNil(decoded.emote)
    }

    func testChatEmote_encodeDecode() throws {
        let emote = ChatEmote(id: "12345")
        let data = try JSONEncoder().encode(emote)
        let decoded = try JSONDecoder().decode(ChatEmote.self, from: data)
        XCTAssertEqual(decoded.id, "12345")
    }
}
