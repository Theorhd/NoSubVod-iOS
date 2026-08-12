import XCTest
@testable import NoSubVod

final class TwitchChatServiceTests: XCTestCase {

    // MARK: - Sanitisation des messages

    func testSanitizeMessage_trimsWhitespace() {
        XCTAssertEqual(TwitchChatService.sanitizeMessage("  hello  "), "hello")
        XCTAssertEqual(TwitchChatService.sanitizeMessage(""), "")
        XCTAssertEqual(TwitchChatService.sanitizeMessage("   "), "")
    }

    func testSanitizeMessage_removesNewlines() {
        XCTAssertEqual(TwitchChatService.sanitizeMessage("line1\nline2"), "line1 line2")
        XCTAssertEqual(TwitchChatService.sanitizeMessage("a\r\nb"), "a b")
    }

    func testSanitizeMessage_capsAt500() {
        let long = String(repeating: "a", count: 1000)
        XCTAssertEqual(TwitchChatService.sanitizeMessage(long).count, 500)
    }

    // MARK: - Format PRIVMSG

    func testPrivmsgPayload_format() {
        XCTAssertEqual(
            TwitchChatService.privmsgPayload(channel: "xqc", text: "hello"),
            "PRIVMSG #xqc :hello"
        )
    }

    func testPrivmsgPayload_lowercasesChannel() {
        XCTAssertEqual(
            TwitchChatService.privmsgPayload(channel: "Zerator", text: "Salut"),
            "PRIVMSG #zerator :Salut"
        )
    }

    func testPrivmsgPayload_preservesMessageCase() {
        XCTAssertEqual(
            TwitchChatService.privmsgPayload(channel: "mistermv", text: "PogChamp"),
            "PRIVMSG #mistermv :PogChamp"
        )
    }

    // MARK: - NOTICE serveur

    func testParseNotice_extractsMessage() {
        XCTAssertEqual(
            TwitchChatService.parseNotice(":tmi.twitch.tv NOTICE #xqc :You are sending messages too fast!"),
            "You are sending messages too fast!"
        )
    }

    func testParseNotice_messageWithColons() {
        XCTAssertEqual(
            TwitchChatService.parseNotice(":tmi.twitch.tv NOTICE #xqc :Bad : message : here"),
            "Bad : message : here"
        )
    }

    func testParseNotice_nonNotice_returnsNil() {
        XCTAssertNil(TwitchChatService.parseNotice(":xqc!xqc@xqc.tmi.twitch.tv PRIVMSG #xqc :hello"))
        XCTAssertNil(TwitchChatService.parseNotice("PING :tmi.twitch.tv"))
        XCTAssertNil(TwitchChatService.parseNotice(""))
    }
}
