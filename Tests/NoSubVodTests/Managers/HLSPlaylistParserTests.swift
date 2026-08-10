import XCTest
@testable import NoSubVod

final class HLSPlaylistParserTests: XCTestCase {

    var parser: HLSPlaylistParser!
    let baseURL = URL(string: "https://example.com/path/")!

    override func setUp() {
        super.setUp()
        parser = HLSPlaylistParser()
    }


    func testParse_standardArchivePlaylist_returnsAllChunks() {
        let playlist = """
        #EXTM3U
        #EXT-X-VERSION:3
        #EXT-X-TARGETDURATION:10
        #EXTINF:10.000,
        0.ts
        #EXTINF:10.000,
        1.ts
        #EXTINF:10.000,
        2.ts
        #EXT-X-ENDLIST
        """

        let result = parser.parse(
            playlist: playlist,
            baseURL: baseURL,
            isSegment: false,
            startTime: nil,
            endTime: nil
        )

        XCTAssertEqual(result.chunks.count, 3)
        XCTAssertEqual(result.targetDuration, 10)
        XCTAssertEqual(result.version, 3)
        XCTAssertNil(result.firstMapFilename)
        XCTAssertTrue(result.initSegmentURLs.isEmpty)
    }

    func testParse_extractsDurations_correctly() {
        let playlist = """
        #EXTM3U
        #EXTINF:5.500,
        chunk1.ts
        #EXTINF:7.250,
        chunk2.ts
        #EXT-X-ENDLIST
        """

        let result = parser.parse(
            playlist: playlist,
            baseURL: baseURL,
            isSegment: false,
            startTime: nil,
            endTime: nil
        )

        XCTAssertEqual(result.chunks.count, 2)
        XCTAssertEqual(result.chunks[0].duration, 5.5)
        XCTAssertEqual(result.chunks[1].duration, 7.25)
    }

    func testParse_resolvesChunkURLs_relativeToBaseURL() {
        let playlist = """
        #EXTM3U
        #EXTINF:10.0,
        videos/chunk_0.ts
        #EXT-X-ENDLIST
        """

        let result = parser.parse(
            playlist: playlist,
            baseURL: baseURL,
            isSegment: false,
            startTime: nil,
            endTime: nil
        )

        XCTAssertEqual(result.chunks.count, 1)
        XCTAssertEqual(result.chunks[0].filename, "chunk_0.ts")
        XCTAssertTrue(result.chunks[0].remoteURL.absoluteString.contains("chunk_0.ts"))
    }


    func testParse_fMP4_playlist_extractsMapAndChunks() {
        let playlist = """
        #EXTM3U
        #EXT-X-VERSION:6
        #EXT-X-TARGETDURATION:2
        #EXT-X-MAP:URI="init-fmp4.mp4"
        #EXTINF:2.000,
        0-fmp4.m4s
        #EXTINF:2.000,
        1-fmp4.m4s
        #EXT-X-ENDLIST
        """

        let result = parser.parse(
            playlist: playlist,
            baseURL: baseURL,
            isSegment: false,
            startTime: nil,
            endTime: nil
        )

        XCTAssertEqual(result.chunks.count, 2)
        XCTAssertEqual(result.firstMapFilename, "init-fmp4.mp4")
        XCTAssertEqual(result.initSegmentURLs.count, 1)
        // Version should be bumped to >= 6 for fMP4
        XCTAssertEqual(result.version, 6)
    }

    func testParse_midPlaylistMAP_changes() {
        let playlist = """
        #EXTM3U
        #EXT-X-VERSION:6
        #EXT-X-MAP:URI="init-1.mp4"
        #EXTINF:2.000,
        chunk-0.m4s
        #EXT-X-MAP:URI="init-2.mp4"
        #EXTINF:2.000,
        chunk-1.m4s
        #EXT-X-ENDLIST
        """

        let result = parser.parse(
            playlist: playlist,
            baseURL: baseURL,
            isSegment: false,
            startTime: nil,
            endTime: nil
        )

        XCTAssertEqual(result.chunks.count, 2)
        XCTAssertEqual(result.firstMapFilename, "init-1.mp4")
        XCTAssertEqual(result.initSegmentURLs.count, 2)
        // Mid-playlist MAP is attached to the next chunk after the MAP tag
        XCTAssertNil(result.chunks[0].nextMapFilename)
        XCTAssertEqual(result.chunks[1].nextMapFilename, "init-2.mp4")
    }

    func testParse_fMP4_versionBumpedToSix_WhenLowerVersion() {
        let playlist = """
        #EXTM3U
        #EXT-X-VERSION:3
        #EXT-X-MAP:URI="init.mp4"
        #EXTINF:2.000,
        chunk.m4s
        #EXT-X-ENDLIST
        """

        let result = parser.parse(
            playlist: playlist,
            baseURL: baseURL,
            isSegment: false,
            startTime: nil,
            endTime: nil
        )

        // Version should be bumped from 3 to 6 when MAP is present
        XCTAssertEqual(result.version, 6)
    }


    func testParse_segmentMode_filtersChunks() {
        // 10 chunks of 10 seconds each = 100 seconds total
        var lines = ["#EXTM3U", "#EXT-X-TARGETDURATION:10"]
        for i in 0..<10 {
            lines.append("#EXTINF:10.000,")
            lines.append("chunk_\(i).ts")
        }
        lines.append("#EXT-X-ENDLIST")

        let result = parser.parse(
            playlist: lines.joined(separator: "\n"),
            baseURL: baseURL,
            isSegment: true,
            startTime: 30,  // start at 30s
            endTime: 60     // end at 60s
        )

        // Should include chunks at times 30, 40, 50 (total 30-60)
        // chunk_3: 30-40, chunk_4: 40-50, chunk_5: 50-60
        XCTAssertEqual(result.chunks.count, 3)
        XCTAssertEqual(result.chunks[0].filename, "chunk_3.ts")
        XCTAssertEqual(result.chunks[2].filename, "chunk_5.ts")
    }

    func testParse_segmentMode_includesPartialOverlap() {
        var lines = ["#EXTM3U"]
        for i in 0..<3 {
            lines.append("#EXTINF:10.000,")
            lines.append("chunk_\(i).ts")
        }
        lines.append("#EXT-X-ENDLIST")

        let result = parser.parse(
            playlist: lines.joined(separator: "\n"),
            baseURL: baseURL,
            isSegment: true,
            startTime: 5,   // start at 5s
            endTime: 25     // end at 25s
        )

        // chunk_0 (0-10): 10 > 5 && 0 < 25 → included
        // chunk_1 (10-20): 20 > 5 && 10 < 25 → included
        // chunk_2 (20-30): 30 > 5 && 20 < 25 → included
        XCTAssertEqual(result.chunks.count, 3)
    }


    func testParse_discontinuity_tagsCollected() {
        let playlist = """
        #EXTM3U
        #EXTINF:10.000,
        chunk_0.ts
        #EXT-X-DISCONTINUITY
        #EXTINF:10.000,
        chunk_1.ts
        #EXT-X-ENDLIST
        """

        let result = parser.parse(
            playlist: playlist,
            baseURL: baseURL,
            isSegment: false,
            startTime: nil,
            endTime: nil
        )

        XCTAssertEqual(result.chunks.count, 2)
        // DISCONTINUITY should be collected as a trailing tag on chunk_0
        XCTAssertTrue(result.chunks[0].trailingTags.contains("#EXT-X-DISCONTINUITY"))
        XCTAssertTrue(result.chunks[1].trailingTags.isEmpty)
    }


    func testParse_emptyPlaylist_returnsEmpty() {
        let result = parser.parse(
            playlist: "",
            baseURL: baseURL,
            isSegment: false,
            startTime: nil,
            endTime: nil
        )

        XCTAssertTrue(result.chunks.isEmpty)
        XCTAssertEqual(result.targetDuration, 10)
        XCTAssertEqual(result.version, 3)
    }

    func testParse_skipsTwitchPrefetchTags() {
        let playlist = """
        #EXTM3U
        #EXT-X-TWITCH-ELAPSED-SECS:0.000
        #EXT-X-TWITCH-TOTAL-SECS:60.000
        #EXTINF:10.000,
        chunk.ts
        #EXT-X-ENDLIST
        """

        let result = parser.parse(
            playlist: playlist,
            baseURL: baseURL,
            isSegment: false,
            startTime: nil,
            endTime: nil
        )

        // PREFETCH tags should be skipped, we should get 1 chunk
        XCTAssertEqual(result.chunks.count, 1)
    }

    func testParse_handlesMultipleDiscontinuities() {
        let playlist = """
        #EXTM3U
        #EXTINF:10.0,
        a.ts
        #EXT-X-DISCONTINUITY
        #EXT-X-DISCONTINUITY
        #EXTINF:10.0,
        b.ts
        #EXT-X-ENDLIST
        """

        let result = parser.parse(
            playlist: playlist,
            baseURL: baseURL,
            isSegment: false,
            startTime: nil,
            endTime: nil
        )

        XCTAssertEqual(result.chunks.count, 2)
        XCTAssertEqual(result.chunks[0].trailingTags.count, 2)
        XCTAssertTrue(result.chunks[0].trailingTags[0].contains("DISCONTINUITY"))
    }

    func testParse_skipsHeaderTags() {
        let playlist = """
        #EXTM3U
        #EXT-X-TARGETDURATION:15
        #EXT-X-VERSION:5
        #EXT-X-MEDIA-SEQUENCE:100
        #EXT-X-TWITCH-INFO:ORIGIN=sfo04
        #EXTINF:10.0,
        chunk.ts
        #EXT-X-ENDLIST
        """

        let result = parser.parse(
            playlist: playlist,
            baseURL: baseURL,
            isSegment: false,
            startTime: nil,
            endTime: nil
        )

        XCTAssertEqual(result.targetDuration, 15)
        XCTAssertEqual(result.version, 5)
        XCTAssertEqual(result.chunks.count, 1)
    }
}
