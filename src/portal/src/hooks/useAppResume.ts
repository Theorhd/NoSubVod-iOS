import { useEffect, useRef, useState } from "react";
import { isTauriRuntime } from "../utils/capabilities";

/**
 * Detects when the app returns from the iOS background (or any hidden state).
 * Returns a `resumeCount` integer that increments on each resume event.
 * Components can use this as a dependency to trigger a refresh.
 *
 * Sources listened:
 *  1. `document.visibilitychange` → hidden→visible transition
 *  2. `pageshow` (browser BFCache / page restore)
 *  3. Tauri `nsv-app-resumed` event (emitted by the Rust RunEvent::Resumed handler)
 */
export function useAppResume() {
  const [resumeCount, setResumeCount] = useState(0);
  // Track previous visibility so we only fire on hidden→visible transitions
  const wasHiddenRef = useRef(false);

  useEffect(() => {
    const bump = () => {
      setResumeCount((c) => c + 1);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        wasHiddenRef.current = true;
      } else if (wasHiddenRef.current) {
        wasHiddenRef.current = false;
        bump();
      }
    };

    const handlePageShow = (e: PageTransitionEvent) => {
      // Only fire when page is actually being restored (not initial load)
      if (e.persisted) {
        bump();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    globalThis.addEventListener("pageshow", handlePageShow);

    // Also listen for the Tauri-emitted resume event from the Rust side
    let unlistenTauri: (() => void) | undefined;
    if (isTauriRuntime()) {
      void import("@tauri-apps/api/event").then(({ listen }) => {
        void listen("nsv-app-resumed", () => {
          bump();
        }).then((unlisten) => {
          unlistenTauri = unlisten;
        });
      });
    }

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      globalThis.removeEventListener("pageshow", handlePageShow);
      unlistenTauri?.();
    };
  }, []);

  return resumeCount;
}
