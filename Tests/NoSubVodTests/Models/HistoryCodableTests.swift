import XCTest
@testable import NoSubVod

final class HistoryCodableTests: XCTestCase {

    func testHistoryEntry_encodeDecode_roundTrip() throws {
        let entry = HistoryEntry(
            vodId: "vod-123",
            timecode: 300,
            duration: 3600,
            updatedAt: Date(timeIntervalSince1970: 1718000000)
        )

        let data = try JSONEncoder().encode(entry)
        let decoded = try JSONDecoder().decode(HistoryEntry.self, from: data)

        XCTAssertEqual(decoded.vodId, "vod-123")
        XCTAssertEqual(decoded.timecode, 300)
        XCTAssertEqual(decoded.duration, 3600)
        // Note: id (UUID) is excluded from CodingKeys, so it should be regenerated on decode
    }

    func testHistoryEntry_idIsExcludedFromCodingKeys() throws {
        let entry = HistoryEntry(
            vodId: "vod-456",
            timecode: 100,
            duration: 2000,
            updatedAt: Date()
        )

        let data = try JSONEncoder().encode(entry)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        // id should NOT be in the JSON
        XCTAssertNil(json?["id"])
        XCTAssertEqual(json?["vodId"] as? String, "vod-456")
        XCTAssertEqual(json?["timecode"] as? Int, 100)
        XCTAssertEqual(json?["duration"] as? Int, 2000)
    }

    func testWatchlistEntry_encodeDecode_roundTrip() throws {
        let entry = WatchlistEntry(
            vodId: "vod-789",
            title: "Test VOD",
            previewThumbnailURL: URL(string: "https://example.com/thumb.jpg"),
            lengthSeconds: 7200,
            addedAt: Date(timeIntervalSince1970: 1718000000)
        )

        let data = try JSONEncoder().encode(entry)
        let decoded = try JSONDecoder().decode(WatchlistEntry.self, from: data)

        XCTAssertEqual(decoded.vodId, "vod-789")
        XCTAssertEqual(decoded.title, "Test VOD")
        XCTAssertEqual(decoded.previewThumbnailURL, URL(string: "https://example.com/thumb.jpg"))
        XCTAssertEqual(decoded.lengthSeconds, 7200)
    }

    func testWatchlistEntry_idIsExcludedFromCodingKeys() throws {
        let entry = WatchlistEntry(
            vodId: "vod-000",
            title: "Watchlist VOD",
            previewThumbnailURL: nil,
            lengthSeconds: 3600,
            addedAt: Date()
        )

        let data = try JSONEncoder().encode(entry)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertNil(json?["id"])
        XCTAssertEqual(json?["vodId"] as? String, "vod-000")
        XCTAssertEqual(json?["title"] as? String, "Watchlist VOD")
    }
}
