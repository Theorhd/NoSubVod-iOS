import SwiftUI
import AVKit

/// The player view controller shared by inline and full-screen presentations.
///
/// Subclassing `AVPlayerViewController` gives us one hook the base class
/// doesn't expose: knowing when the *modal* full-screen presentation we
/// started ourselves is dismissed (the Done button). AVKit's own full-screen
/// window presentation (the native toolbar button) is tracked through the
/// delegate callbacks instead — see `PlayerFullscreenDelegate`.
final class NSVPlayerViewController: AVPlayerViewController {
    /// Called once when the modal full-screen presentation is dismissed
    /// (Done button). Not called for AVKit's native full-screen path
    /// (that one goes through the delegate).
    var onDismissed: (() -> Void)?

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed {
            onDismissed?()
        }
    }
}

/// A UIViewController that hosts the shared `AVPlayerViewController` and
/// re-attaches it every time this container (re)appears.
///
/// This is the piece that makes full-screen transitions smooth:
/// - both the inline player and the full-screen presentation are backed by
///   *the same* `NSVPlayerViewController` instance,
/// - full-screen is a plain UIKit modal presentation (`presentFullScreen`):
///   UIKit moves the view to the presentation container and restores it
///   automatically on dismiss — the player layer is never rebuilt, so there
///   is no black screen, no pause, no jump.
final class PlayerHostViewController: UIViewController, UIAdaptivePresentationControllerDelegate {
    let playerController: NSVPlayerViewController
    /// Called synchronously just before the modal presentation, so the view
    /// model can request landscape BEFORE the presentation starts — this
    /// avoids a mid-transition rotation jump.
    var onPrepareForFullScreen: (() -> Void)?

    init(playerController: NSVPlayerViewController) {
        self.playerController = playerController
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        attachIfNeeded()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        attachIfNeeded()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Orphaned-view recovery (the black-zone fix): after a presentation
        // stole and released the player's view, re-home it.
        if playerController.view.superview == nil,
           playerController.view.window == nil,
           playerController.presentingViewController == nil {
            attachIfNeeded()
            return
        }
        // Only size the player while its view is actually in OUR hierarchy.
        // During a modal presentation (or AVKit's native full-screen or PiP)
        // the view lives elsewhere — forcing the frame there would fight the
        // presentation and could resize the full-screen video.
        guard playerController.view.superview === view else { return }
        playerController.view.frame = view.bounds
    }

    /// Presents the shared player full-screen as a modal. UIKit keeps the
    /// same view controller instance: the view moves to the presentation
    /// container and comes back to `view` on dismiss.
    ///
    /// Returns `false` (without side effects) when the presentation cannot
    /// start yet — e.g. the views are not in a window, or a presentation is
    /// already in flight. The caller may retry later.
    @discardableResult
    func presentFullScreen() -> Bool {
        guard view.window != nil,
              playerController.view.window != nil,
              presentedViewController == nil,
              !playerController.isBeingPresented,
              !playerController.isBeingDismissed,
              playerController.presentingViewController == nil
        else { return false }

        onPrepareForFullScreen?()
        playerController.modalPresentationStyle = .fullScreen
        present(playerController, animated: true, completion: nil)
        // Created synchronously during present(); lets us observe the
        // Done-button dismissal.
        playerController.presentationController?.delegate = self
        return true
    }

    /// Dismisses the modal full-screen presentation, if any.
    func exitFullScreen() {
        guard playerController.presentingViewController == self else { return }
        playerController.dismiss(animated: true)
    }

    /// Re-homes the player's view into this host (used by the restore-UI
    /// delegate callbacks). No-op when it is already ours.
    func reattach() {
        attachIfNeeded()
    }

    /// The Done button closed the modal — bring the player's view back home.
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        attachIfNeeded()
        playerController.onDismissed?()
    }

    /// Hosts the player's VIEW only — deliberately NO view-controller
    /// containment (`addChild`): presenting a view controller that has a
    /// parent throws `NSInvalidArgumentException` on iOS 26, and the view
    /// itself renders fine standalone. UIKit moves the view into the modal
    /// presentation container and restores it to `view` on dismissal.
    private func attachIfNeeded() {
        // Already ours: nothing to do.
        if playerController.view.superview === view { return }
        // Never steal a view that lives elsewhere (an active modal
        // presentation, AVKit's native full-screen, or PiP) — yanking it
        // mid-transition would break that presentation.
        guard playerController.view.superview == nil,
              playerController.presentingViewController == nil else { return }
        playerController.view.frame = view.bounds
        playerController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(playerController.view)
    }
}

/// SwiftUI representable for the shared player controller.
struct CustomVideoPlayer: UIViewControllerRepresentable {
    let playerController: NSVPlayerViewController
    /// Called once with the host view controller, so the view model can
    /// present/dismiss the modal full-screen from UIKit.
    var onHostReady: (PlayerHostViewController) -> Void = { _ in }

    func makeUIViewController(context: Context) -> PlayerHostViewController {
        let host = PlayerHostViewController(playerController: playerController)
        onHostReady(host)
        return host
    }

    func updateUIViewController(_ host: PlayerHostViewController, context: Context) {
        // Player is bound once and never changes; reparenting is handled
        // by the host's lifecycle.
    }
}
