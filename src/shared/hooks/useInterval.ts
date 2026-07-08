import { useEffect, useRef } from "react";

/**
 * Like setInterval, but automatically pauses when the page is hidden
 * (e.g. iOS background) and resumes — firing the callback immediately —
 * when the page becomes visible again.
 */
export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) {
      return undefined;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        savedCallback.current();
      }, delay);
    };

    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        // Fire immediately on resume so the UI refreshes right away,
        // then restart the regular cadence.
        savedCallback.current();
        start();
      }
    };

    // Only start if the page is currently visible.
    if (
      typeof document === "undefined" ||
      document.visibilityState !== "hidden"
    ) {
      start();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [delay]);
}
