import { useEffect, useState } from "react";

function resolvePageVisibility(): boolean {
  if (typeof document === "undefined") {
    return true;
  }

  if (document.visibilityState === "visible") {
    return true;
  }

  if (typeof document.hasFocus === "function" && document.hasFocus()) {
    return true;
  }

  return false;
}

export function usePageVisibility() {
  const [isPageVisible, setIsPageVisible] = useState(resolvePageVisibility);

  useEffect(() => {
    const syncVisibility = () => {
      setIsPageVisible(resolvePageVisibility());
    };

    const markVisible = () => {
      setIsPageVisible(true);
    };

    const markPotentiallyVisibleFromInteraction = () => {
      if (document.visibilityState !== "hidden") {
        setIsPageVisible(true);
      }
    };

    const markHidden = () => {
      setIsPageVisible(false);
    };

    document.addEventListener("visibilitychange", syncVisibility);
    globalThis.addEventListener("pageshow", markVisible);
    globalThis.addEventListener("focus", markVisible);
    globalThis.addEventListener("pagehide", markHidden);
    globalThis.addEventListener(
      "touchstart",
      markPotentiallyVisibleFromInteraction,
      { passive: true },
    );
    globalThis.addEventListener(
      "pointerdown",
      markPotentiallyVisibleFromInteraction,
      { passive: true },
    );

    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      globalThis.removeEventListener("pageshow", markVisible);
      globalThis.removeEventListener("focus", markVisible);
      globalThis.removeEventListener("pagehide", markHidden);
      globalThis.removeEventListener(
        "touchstart",
        markPotentiallyVisibleFromInteraction,
      );
      globalThis.removeEventListener(
        "pointerdown",
        markPotentiallyVisibleFromInteraction,
      );
    };
  }, []);

  return isPageVisible;
}
