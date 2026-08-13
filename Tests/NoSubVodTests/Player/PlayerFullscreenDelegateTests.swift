import XCTest
import AVFoundation
import AVKit
import UIKit
@testable import NoSubVod

// MARK: - Mocks

private final class MockTransitionContext: NSObject, UIViewControllerTransitionCoordinatorContext {
    private let cancelledValue: Bool

    init(cancelled: Bool = false) {
        self.cancelledValue = cancelled
    }

    var isInteractive: Bool { false }
    var isCancelled: Bool { cancelledValue }
    var isCompleting: Bool { !cancelledValue }
    var isAnimated: Bool { true }
    var isInterruptible: Bool { true }
    var percentComplete: CGFloat { cancelledValue ? 0 : 1 }
    var transitionDuration: TimeInterval { 0.3 }
    var presentationStyle: UIModalPresentationStyle { .fullScreen }
    var completionCurve: UIView.AnimationCurve { .easeInOut }
    var completionVelocity: CGFloat { 0 }
    var initiallyInteractive: Bool { false }
    var targetTransform: CGAffineTransform { .identity }
    var containerView: UIView { UIView() }

    func viewController(forKey key: UITransitionContextViewControllerKey) -> UIViewController? { nil }
    func view(forKey key: UITransitionContextViewKey) -> UIView? { nil }
}

private final class MockTransitionCoordinator: NSObject, UIViewControllerTransitionCoordinator {
    private(set) var animateCallCount = 0
    private var capturedCompletion: ((UIViewControllerTransitionCoordinatorContext) -> Void)?

    func animate(alongsideTransition animation: ((UIViewControllerTransitionCoordinatorContext) -> Void)?,
                 completion: ((UIViewControllerTransitionCoordinatorContext) -> Void)?) -> Bool {
        animateCallCount += 1
        capturedCompletion = completion
        return true
    }

    func animateAlongsideTransition(in view: UIView?,
                                    animation: ((UIViewControllerTransitionCoordinatorContext) -> Void)?,
                                    completion: ((UIViewControllerTransitionCoordinatorContext) -> Void)?) -> Bool {
        true
    }

    /// Drives the stored transition completion to its end.
    func complete(cancelled: Bool = false) {
        capturedCompletion?(MockTransitionContext(cancelled: cancelled))
    }

    var isInteractive: Bool { false }
    var isCancelled: Bool { false }
    var isCompleting: Bool { true }
    var isAnimated: Bool { true }
    var isInterruptible: Bool { true }
    var percentComplete: CGFloat { 1 }
    var transitionDuration: TimeInterval { 0.3 }
    var presentationStyle: UIModalPresentationStyle { .fullScreen }
    var completionCurve: UIView.AnimationCurve { .easeInOut }
    var completionVelocity: CGFloat { 0 }
    var initiallyInteractive: Bool { false }
    var targetTransform: CGAffineTransform { .identity }
    var containerView: UIView { UIView() }

    func viewController(forKey key: UITransitionContextViewControllerKey) -> UIViewController? { nil }
    func view(forKey key: UITransitionContextViewKey) -> UIView? { nil }
    func notifyWhenInteractionChanges(_ changeHandler: @escaping (UIViewControllerTransitionCoordinatorContext) -> Void) {}
    func notifyWhenInteractionEnds(_ changeHandler: @escaping (UIViewControllerTransitionCoordinatorContext) -> Void) {}
}

// MARK: - Tests

/// The delegate is the seam between AVKit's native full-screen transitions
/// and the view model: it must publish the state at the right moments and
/// compensate the layer-detach rate reset.
final class PlayerFullscreenDelegateTests: XCTestCase {
    private var delegate: PlayerFullscreenDelegate!

    override func setUp() {
        super.setUp()
        delegate = PlayerFullscreenDelegate()
    }

    override func tearDown() {
        delegate = nil
        super.tearDown()
    }

    // MARK: State capture

    func testBeginFullScreen_capturesPlayingState() {
        delegate.beginFullScreen(wasPlaying: true)
        XCTAssertTrue(delegate.shouldResumeAfterTransition)

        delegate.beginFullScreen(wasPlaying: false)
        XCTAssertFalse(delegate.shouldResumeAfterTransition)
    }

    // MARK: willBegin

    func testWillBegin_publishesFullScreenImmediately() {
        let coordinator = MockTransitionCoordinator()
        let controller = NSVPlayerViewController()
        let exp = expectation(description: "full-screen=true published")
        var received: Bool?
        delegate.onFullScreenChange = { value in
            received = value
            exp.fulfill()
        }

        delegate.playerViewController(controller, willBeginFullScreenPresentationWithAnimationCoordinator: coordinator)

        wait(for: [exp], timeout: 1)
        XCTAssertEqual(received, true)
        XCTAssertEqual(coordinator.animateCallCount, 1)
    }

    func testWillBegin_playingPlayer_resumesInCompletionAfterRateReset() {
        let coordinator = MockTransitionCoordinator()
        let controller = NSVPlayerViewController()
        let player = AVPlayer()
        player.play() // empirically: rate becomes 1.0 even without an item
        controller.player = player

        delegate.playerViewController(controller, willBeginFullScreenPresentationWithAnimationCoordinator: coordinator)
        XCTAssertTrue(delegate.shouldResumeAfterTransition)

        // The transition detaches the layer and resets the rate...
        player.pause()
        XCTAssertEqual(player.rate, 0.0)

        // ...and its completion restores playback (the bug #2 fix).
        coordinator.complete()
        XCTAssertEqual(player.rate, 1.0)
    }

    func testWillBegin_pausedPlayer_doesNotResume() {
        let coordinator = MockTransitionCoordinator()
        let controller = NSVPlayerViewController()
        let player = AVPlayer()
        controller.player = player

        delegate.playerViewController(controller, willBeginFullScreenPresentationWithAnimationCoordinator: coordinator)
        XCTAssertFalse(delegate.shouldResumeAfterTransition)

        coordinator.complete()
        XCTAssertEqual(player.rate, 0.0) // deliberate pause is respected
    }

    func testWillBegin_cancelledTransition_doesNotResumeAndPublishesFalse() {
        let coordinator = MockTransitionCoordinator()
        let controller = NSVPlayerViewController()
        let player = AVPlayer()
        player.play()
        controller.player = player

        let exp = expectation(description: "state backed out")
        var received: [Bool] = []
        delegate.onFullScreenChange = { value in
            received.append(value)
            if value == false { exp.fulfill() }
        }

        delegate.playerViewController(controller, willBeginFullScreenPresentationWithAnimationCoordinator: coordinator)
        XCTAssertTrue(delegate.shouldResumeAfterTransition)

        player.pause()
        coordinator.complete(cancelled: true)

        wait(for: [exp], timeout: 1)
        XCTAssertEqual(received, [true, false]) // true published, then backed out
        XCTAssertEqual(player.rate, 0.0)
    }

    // MARK: willEnd

    func testWillEnd_publishesFalse_onlyAfterCompletion() {
        let coordinator = MockTransitionCoordinator()
        let controller = NSVPlayerViewController()
        let exp = expectation(description: "full-screen=false published")
        var received: [Bool] = []
        delegate.onFullScreenChange = { value in
            received.append(value)
            if value == false { exp.fulfill() }
        }

        delegate.playerViewController(controller, willEndFullScreenPresentationWithAnimationCoordinator: coordinator)

        // Not delivered until the exit transition completes.
        XCTAssertEqual(received, [])

        coordinator.complete()
        wait(for: [exp], timeout: 1)
        XCTAssertEqual(received, [false])
    }

    func testWillEnd_cancelledExit_staysFullScreen() {
        let coordinator = MockTransitionCoordinator()
        let controller = NSVPlayerViewController()
        var received: [Bool] = []
        delegate.onFullScreenChange = { received.append($0) }

        delegate.playerViewController(controller, willEndFullScreenPresentationWithAnimationCoordinator: coordinator)

        // The landscape lock re-asserted mid-exit: transition cancelled —
        // no "end of full-screen" may be published.
        coordinator.complete(cancelled: true)

        // Small runloop hop so any (wrong) async delivery would land before
        // the assertion.
        let exp = expectation(description: "hop")
        DispatchQueue.main.async { exp.fulfill() }
        wait(for: [exp], timeout: 1)
        XCTAssertEqual(received, [])
    }

    func testWillEnd_playingPlayer_resumesAfterExit() {
        let coordinator = MockTransitionCoordinator()
        let controller = NSVPlayerViewController()
        let player = AVPlayer()
        player.play()
        controller.player = player

        let exp = expectation(description: "end published")
        delegate.onFullScreenChange = { value in
            if value == false { exp.fulfill() }
        }

        delegate.playerViewController(controller, willEndFullScreenPresentationWithAnimationCoordinator: coordinator)

        // The exit transition leaves the rate at 0 (layer re-attach)...
        player.pause()
        coordinator.complete()

        // ...and the completion restores playback (the black-zone fix).
        wait(for: [exp], timeout: 1)
        XCTAssertEqual(player.rate, 1.0)
    }

    // MARK: PiP

    func testAutomaticallyDismissesAtPictureInPictureStart() {
        XCTAssertTrue(delegate.playerViewControllerShouldAutomaticallyDismissAtPictureInPictureStart(NSVPlayerViewController()))
    }

    func testPictureInPictureWillStart_invokesCallback() {
        let exp = expectation(description: "PiP will start")
        delegate.onPictureInPictureWillStart = { exp.fulfill() }
        delegate.playerViewControllerWillStartPictureInPicture(NSVPlayerViewController())
        wait(for: [exp], timeout: 1)
    }

    func testRestoreUserInterface_alwaysRestores() {
        let controller = NSVPlayerViewController()
        let exp = expectation(description: "restored")
        delegate.playerViewController(controller, restoreUserInterfaceForPictureInPictureStopWithCompletionHandler: { restored in
            XCTAssertTrue(restored)
            exp.fulfill()
        })
        wait(for: [exp], timeout: 1)
    }
}
