import SwiftUI
import AVKit

/// A UIViewController that hosts a shared `AVPlayerViewController` and
/// re-attaches it every time this container (re)appears.
///
/// This is the piece that makes full-screen transitions smooth:
/// - both the inline player and the full-screen cover are backed by
///   *the same* `AVPlayerViewController` instance,
/// - moving it between parents keeps the player layer alive across
///   SwiftUI reparenting (no AVPlayer rebuild, no seek glitch, no jump).
final class PlayerHostViewController: UIViewController {
    let playerController: AVPlayerViewController

    var automaticallyPlaysOnAttach = false

    init(playerController: AVPlayerViewController) {
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
        guard playerController.parent == self else { return }
        playerController.view.frame = view.bounds
    }

    private func attachIfNeeded() {
        guard playerController.parent != self else { return }

        // UIKit automatically removes from the previous parent when
        // addChild is called; the view also migrates via addSubview.
        addChild(playerController)
        playerController.view.frame = view.bounds
        playerController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(playerController.view)
        playerController.didMove(toParent: self)
    }
}

/// SwiftUI representable for the shared player controller.
struct CustomVideoPlayer: UIViewControllerRepresentable {
    let playerController: AVPlayerViewController

    func makeUIViewController(context: Context) -> PlayerHostViewController {
        PlayerHostViewController(playerController: playerController)
    }

    func updateUIViewController(_ host: PlayerHostViewController, context: Context) {
        // Player is bound once and never changes; reparenting is handled
        // by the host's lifecycle.
    }
}
