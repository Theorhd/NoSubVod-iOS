import XCTest
import UIKit
import AVKit
@testable import NoSubVod

/// Exercises the re-parenting mechanics that previously caused the
/// black-zone regressions: attach, orphan recovery, and the modal
/// presentation / dismissal cycle.
@MainActor
final class PlayerHostViewControllerTests: XCTestCase {
    private var host: PlayerHostViewController!
    private var controller: NSVPlayerViewController!

    override func setUp() {
        super.setUp()
        controller = NSVPlayerViewController()
        host = PlayerHostViewController(playerController: controller)
    }

    override func tearDown() {
        host = nil
        controller = nil
        super.tearDown()
    }

    func testViewLoad_attachesPlayerView() {
        host.loadViewIfNeeded()
        XCTAssertTrue(controller.view.superview === host.view)
        XCTAssertEqual(controller.view.autoresizingMask, [.flexibleWidth, .flexibleHeight])
        // Deliberately NO containment: presenting a contained view controller
        // throws on iOS 26. The player's view is hosted, not its VC.
        XCTAssertNil(controller.parent)
    }

    func testAttach_isIdempotent() {
        host.loadViewIfNeeded()
        host.viewDidAppear(false)
        host.viewDidAppear(false)
        XCTAssertTrue(controller.view.superview === host.view)
        XCTAssertEqual(host.view.subviews.filter { $0 === controller.view }.count, 1)
    }

    /// The black-zone root cause: a view stolen and released by a
    /// presentation ends up orphaned (no superview). The host must re-home
    /// it on the next layout pass.
    func testOrphanedView_isReattachedOnLayout() {
        host.loadViewIfNeeded()
        controller.view.removeFromSuperview()
        XCTAssertNil(controller.view.superview)

        host.viewDidLayoutSubviews()

        XCTAssertTrue(controller.view.superview === host.view)
    }

    /// While the player's view lives in another window (an active
    /// presentation, PiP, AVKit full-screen), the host must NOT steal it.
    func testOrphanedView_notStolenWhileInAWindow() {
        host.loadViewIfNeeded()
        controller.view.removeFromSuperview()

        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 400))
        window.addSubview(controller.view)

        host.viewDidLayoutSubviews()

        XCTAssertTrue(controller.view.superview === window, "must not steal a view that lives in another window")
        window.subviews.forEach { $0.removeFromSuperview() }
    }

    /// Full modal cycle: present → presented relationship, dismiss (Done
    /// button path) → onDismissed fires and the controller is back home.
    func testPresentAndDismiss_modalCycle() throws {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.loadViewIfNeeded()
        defer { window.isHidden = true }

        let presented = host.presentFullScreen()
        XCTAssertTrue(presented)
        XCTAssertTrue(host.presentedViewController === controller)
        XCTAssertEqual(controller.modalPresentationStyle, .fullScreen)

        let dismissed = expectation(description: "onDismissed fired")
        controller.onDismissed = { dismissed.fulfill() }
        controller.dismiss(animated: false)
        wait(for: [dismissed], timeout: 2)

        XCTAssertNil(host.presentedViewController)
        XCTAssertTrue(controller.view.superview === host.view, "player view is restored to the host")
    }

    func testPresentFullScreen_noop_whenNotWindowed() {
        // Host not in a window: the presentation must be refused, not crash.
        host.loadViewIfNeeded()
        XCTAssertFalse(host.presentFullScreen())
        XCTAssertNil(host.presentedViewController)
    }

    func testPresentFullScreen_noop_whenAlreadyPresented() throws {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.loadViewIfNeeded()
        defer { window.isHidden = true }

        XCTAssertTrue(host.presentFullScreen())
        XCTAssertFalse(host.presentFullScreen(), "second presentation must be refused")
        XCTAssertTrue(host.presentedViewController === controller)

        controller.dismiss(animated: false)
    }

    func testExitFullScreen_dismissesOnlyOwnPresentation() throws {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.loadViewIfNeeded()
        defer { window.isHidden = true }

        host.exitFullScreen() // nothing presented: no-op
        XCTAssertNil(host.presentedViewController)

        XCTAssertTrue(host.presentFullScreen())
        host.exitFullScreen()

        let exp = expectation(description: "dismissed")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 2)
        XCTAssertNil(host.presentedViewController)
    }
}
