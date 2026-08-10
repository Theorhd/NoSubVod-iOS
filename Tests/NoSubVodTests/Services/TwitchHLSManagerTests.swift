import XCTest
@testable import NoSubVod

final class TwitchHLSManagerTests: XCTestCase {

    func testMapQuality_auto_returnsAuto() {
        XCTAssertEqual(TwitchHLSManager.mapQualityToTwitch("auto"), "auto")
    }

    func testMapQuality_1080p_returnsChunked() {
        XCTAssertEqual(TwitchHLSManager.mapQualityToTwitch("1080p"), "chunked")
    }

    func testMapQuality_720p_returns720p60() {
        XCTAssertEqual(TwitchHLSManager.mapQualityToTwitch("720p"), "720p60")
    }

    func testMapQuality_480p_returns480p30() {
        XCTAssertEqual(TwitchHLSManager.mapQualityToTwitch("480p"), "480p30")
    }

    func testMapQuality_360p_returns360p30() {
        XCTAssertEqual(TwitchHLSManager.mapQualityToTwitch("360p"), "360p30")
    }

    func testMapQuality_160p_returns160p30() {
        XCTAssertEqual(TwitchHLSManager.mapQualityToTwitch("160p"), "160p30")
    }

    func testMapQuality_audioOnly_returnsAudioOnly() {
        XCTAssertEqual(TwitchHLSManager.mapQualityToTwitch("Audio Only"), "audio_only")
    }

    func testMapQuality_unknown_returnsAsIs() {
        XCTAssertEqual(TwitchHLSManager.mapQualityToTwitch("unknown_quality"), "unknown_quality")
    }

    func testMapQuality_empty_returnsEmpty() {
        XCTAssertEqual(TwitchHLSManager.mapQualityToTwitch(""), "")
    }
}
