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

    // MARK: - TTV proxy URL normalization

    func testNormalizeTTVProxyURL_fullURL_staysIntact() {
        XCTAssertEqual(
            TwitchHLSManager.normalizeTTVProxyURL("https://api.ttv.lol"),
            "https://api.ttv.lol"
        )
    }

    func testNormalizeTTVProxyURL_missingScheme_getsHTTPS() {
        XCTAssertEqual(
            TwitchHLSManager.normalizeTTVProxyURL("api.ttv.lol"),
            "https://api.ttv.lol"
        )
    }

    func testNormalizeTTVProxyURL_trailingSlash_isStripped() {
        XCTAssertEqual(
            TwitchHLSManager.normalizeTTVProxyURL("https://api.ttv.lol/"),
            "https://api.ttv.lol"
        )
    }

    func testNormalizeTTVProxyURL_customPathPrefix_isPreserved() {
        XCTAssertEqual(
            TwitchHLSManager.normalizeTTVProxyURL("https://my-proxy.example.com/ttv"),
            "https://my-proxy.example.com/ttv"
        )
    }

    func testNormalizeTTVProxyURL_queryAndFragment_areDropped() {
        XCTAssertEqual(
            TwitchHLSManager.normalizeTTVProxyURL("https://api.ttv.lol?foo=bar#frag"),
            "https://api.ttv.lol"
        )
    }

    func testNormalizeTTVProxyURL_surroundingWhitespace_isTrimmed() {
        XCTAssertEqual(
            TwitchHLSManager.normalizeTTVProxyURL("  https://api.ttv.lol  "),
            "https://api.ttv.lol"
        )
    }

    func testNormalizeTTVProxyURL_nilOrBlank_returnsNil() {
        XCTAssertNil(TwitchHLSManager.normalizeTTVProxyURL(nil))
        XCTAssertNil(TwitchHLSManager.normalizeTTVProxyURL(""))
        XCTAssertNil(TwitchHLSManager.normalizeTTVProxyURL("   "))
    }

    func testNormalizeTTVProxyURL_malformed_returnsNil() {
        XCTAssertNil(TwitchHLSManager.normalizeTTVProxyURL("://"))
        XCTAssertNil(TwitchHLSManager.normalizeTTVProxyURL("https://"))
    }
}
