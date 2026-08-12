import XCTest
import AVFoundation
@testable import NoSubVod

/// Covers the seamless-recovery state machine (stalls, expired CDN tokens)
/// and loadStream idempotence. All network access goes through the
/// `resolveStreamURLOverride` seam — no URL leaves the test process.
@MainActor
final class PlayerRecoveryTests: XCTestCase {

    override func setUp() {
        super.setUp()
        // No AdStrippingProxy (local HTTP server) during tests.
        UserDefaults.standard.set(AdBlockMode.disabled.rawValue, forKey: "adBlockMode")
    }

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: "adBlockMode")
        super.tearDown()
    }

    private func makeViewModel(localPlaylistPath: String? = nil) -> PlayerViewModel {
        let vm = PlayerViewModel(videoID: "testvod", isLive: false, localPlaylistPath: localPlaylistPath)
        vm.recoveryBackoffNanoseconds = { _ in 0 }
        return vm
    }

    /// Polls a MainActor condition until it holds or the timeout expires.
    private func waitUntil(_ timeout: TimeInterval = 3,
                           _ condition: @escaping @MainActor () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return condition()
    }

    func testRecovery_success_completesStateMachine() async {
        let vm = makeViewModel()
        vm.resolveStreamURLOverride = { URL(string: "https://example.com/stream.m3u8")! }

        vm.attemptSeamlessRecovery(reason: "test")
        XCTAssertTrue(vm.isRecovering)
        XCTAssertEqual(vm.playerActivity, .reconnecting)

        let settled = await waitUntil { !vm.isRecovering }
        XCTAssertTrue(settled, "recovery never settled")
        XCTAssertEqual(vm.recoveryAttempts, 1)
        XCTAssertNil(vm.playerActivity)
        XCTAssertNil(vm.errorMessage)
    }

    func testRecovery_failureChainsUntilBudgetThenSurfacesError() async {
        let vm = makeViewModel()
        vm.resolveStreamURLOverride = { throw URLError(.timedOut) }

        vm.attemptSeamlessRecovery(reason: "test")

        let failed = await waitUntil { vm.errorMessage != nil }
        XCTAssertTrue(failed, "error UI never appeared after budget exhaustion")
        // 3 real attempts + the 4th call that finds the budget exhausted.
        XCTAssertEqual(vm.recoveryAttempts, 4)
        XCTAssertNil(vm.playerActivity)
        XCTAssertFalse(vm.isRecovering)
    }

    func testRecovery_budgetRefillsAfterStablePlayback() async {
        let vm = makeViewModel()
        vm.resolveStreamURLOverride = { URL(string: "https://example.com/stream.m3u8")! }

        vm.attemptSeamlessRecovery(reason: "t")
        _ = await waitUntil { !vm.isRecovering }
        vm.attemptSeamlessRecovery(reason: "t")
        _ = await waitUntil { !vm.isRecovering && vm.recoveryAttempts == 2 }
        XCTAssertEqual(vm.recoveryAttempts, 2)

        // 15 min of stable playback: the next recovery gets a fresh budget.
        vm.lastRecoveryDate = Date(timeIntervalSinceNow: -900)
        vm.attemptSeamlessRecovery(reason: "t")
        _ = await waitUntil { !vm.isRecovering }
        XCTAssertEqual(vm.recoveryAttempts, 1)
    }

    func testRecovery_ignoredWhileOneIsInFlight() async {
        let vm = makeViewModel()
        vm.recoveryBackoffNanoseconds = { _ in 400_000_000 } // 0.4 s: still in flight
        vm.resolveStreamURLOverride = { URL(string: "https://example.com/stream.m3u8")! }

        vm.attemptSeamlessRecovery(reason: "first")
        vm.attemptSeamlessRecovery(reason: "second — must be ignored")
        XCTAssertEqual(vm.recoveryAttempts, 1)

        let settled = await waitUntil { !vm.isRecovering }
        XCTAssertTrue(settled)
        XCTAssertEqual(vm.recoveryAttempts, 1)
    }

    func testRecovery_ignoredForLocalPlayback() {
        let vm = makeViewModel(localPlaylistPath: "somevod/index.m3u8")

        vm.attemptSeamlessRecovery(reason: "test")

        XCTAssertEqual(vm.recoveryAttempts, 0)
        XCTAssertNil(vm.playerActivity)
        XCTAssertFalse(vm.isRecovering)
    }

    func testLoadStream_skippedWhenSessionAlreadyActive() async {
        let vm = makeViewModel()
        vm.player = AVPlayer()

        vm.loadStream()

        // The guard returns before spawning any work: no item swap, no error.
        try? await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertNil(vm.errorMessage)
        XCTAssertNil(vm.player?.currentItem)
    }
}
