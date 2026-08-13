import XCTest
import MediaPlayer
import UIKit
@testable import NoSubVod

final class NowPlayingInfoBuilderTests: XCTestCase {
    private func metadata(title: String = "Title", artist: String = "Artist", album: String? = nil, isLive: Bool = false) -> NowPlayingMetadata {
        NowPlayingMetadata(title: title, artist: artist, album: album, artworkURL: nil, isLive: isLive)
    }

    func testVODInfo_includesTitleArtistAlbumDurationElapsedRate() {
        let info = NowPlayingInfoBuilder.makeInfo(
            metadata: metadata(title: "My VOD", artist: "Streamer", album: "Game"),
            duration: 7200,
            elapsed: 42,
            rate: 1.0,
            artwork: nil
        )
        XCTAssertEqual(info[MPMediaItemPropertyTitle] as? String, "My VOD")
        XCTAssertEqual(info[MPMediaItemPropertyArtist] as? String, "Streamer")
        XCTAssertEqual(info[MPMediaItemPropertyAlbumTitle] as? String, "Game")
        XCTAssertEqual(info[MPMediaItemPropertyPlaybackDuration] as? Double, 7200)
        XCTAssertEqual(info[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 42)
        XCTAssertEqual(info[MPNowPlayingInfoPropertyPlaybackRate] as? Float, 1.0)
        XCTAssertEqual(info[MPNowPlayingInfoPropertyDefaultPlaybackRate] as? Float, 1.0)
        XCTAssertNil(info[MPNowPlayingInfoPropertyIsLiveStream])
    }

    func testVODInfo_omitsDurationWhenNaNOrZero() {
        // Duration NaN while the item is still loading → key omitted,
        // not present with a garbage value.
        let nanInfo = NowPlayingInfoBuilder.makeInfo(
            metadata: metadata(), duration: .nan, elapsed: 0, rate: 0, artwork: nil
        )
        XCTAssertNil(nanInfo[MPMediaItemPropertyPlaybackDuration])

        let zeroInfo = NowPlayingInfoBuilder.makeInfo(
            metadata: metadata(), duration: 0, elapsed: 0, rate: 0, artwork: nil
        )
        XCTAssertNil(zeroInfo[MPMediaItemPropertyPlaybackDuration])
    }

    func testLiveInfo_setsLiveFlag_omitsDurationAndElapsed() {
        let info = NowPlayingInfoBuilder.makeInfo(
            metadata: metadata(title: "Live", isLive: true),
            duration: 123,
            elapsed: 42,
            rate: 1.0,
            artwork: nil
        )
        XCTAssertEqual(info[MPNowPlayingInfoPropertyIsLiveStream] as? Bool, true)
        XCTAssertNil(info[MPMediaItemPropertyPlaybackDuration])
        XCTAssertNil(info[MPNowPlayingInfoPropertyElapsedPlaybackTime])
    }

    func testArtwork_includedWhenProvided() {
        let image = UIImage()
        let info = NowPlayingInfoBuilder.makeInfo(
            metadata: metadata(),
            duration: nil,
            elapsed: nil,
            rate: 0,
            artwork: image
        )
        XCTAssertNotNil(info[MPMediaItemPropertyArtwork] as? MPMediaItemArtwork)
    }
}
