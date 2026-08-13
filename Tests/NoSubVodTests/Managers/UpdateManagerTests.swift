import XCTest
@testable import NoSubVod

final class UpdateManagerTests: XCTestCase {

    func testCompareVersions_latestHigher_returnsTrue() {
        XCTAssertTrue(UpdateManager.compareVersions(current: "1.1.1", latest: "1.2.0"))
    }

    func testCompareVersions_sameVersion_returnsFalse() {
        XCTAssertFalse(UpdateManager.compareVersions(current: "1.2.0", latest: "1.2.0"))
    }

    func testCompareVersions_currentHigher_returnsFalse() {
        XCTAssertFalse(UpdateManager.compareVersions(current: "1.2.1", latest: "1.2.0"))
    }

    func testCompareVersions_withVPrefix_returnsTrue() {
        XCTAssertTrue(UpdateManager.compareVersions(current: "1.2.0", latest: "v1.3.0"))
        XCTAssertTrue(UpdateManager.compareVersions(current: "v1.1.0", latest: "V1.2.0"))
    }

    func testCompareVersions_multiDigitComponents_returnsTrue() {
        XCTAssertTrue(UpdateManager.compareVersions(current: "1.9.0", latest: "1.10.0"))
        XCTAssertFalse(UpdateManager.compareVersions(current: "1.10.0", latest: "1.9.0"))
    }

    func testCompareVersions_differentLength_returnsTrue() {
        XCTAssertTrue(UpdateManager.compareVersions(current: "1.0", latest: "1.0.1"))
        XCTAssertFalse(UpdateManager.compareVersions(current: "1.0.1", latest: "1.0"))
    }

    func testGitHubRelease_displayVersion_stripsPrefix() {
        let releaseWithV = GitHubRelease(
            tagName: "v1.2.5",
            htmlUrl: "https://github.com/Theorhd/NoSubVod-iOS/releases/tag/v1.2.5",
            name: "Release 1.2.5",
            body: "Changelog"
        )
        XCTAssertEqual(releaseWithV.displayVersion, "1.2.5")

        let releaseWithoutV = GitHubRelease(
            tagName: "2.0.0",
            htmlUrl: "https://github.com/Theorhd/NoSubVod-iOS/releases/tag/2.0.0",
            name: "Release 2.0.0",
            body: "Changelog"
        )
        XCTAssertEqual(releaseWithoutV.displayVersion, "2.0.0")
    }
}
