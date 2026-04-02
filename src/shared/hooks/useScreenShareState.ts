import { useState, useCallback, useEffect } from "react";
import { ScreenShareSessionState } from "../types";
import { useInterval } from "./useInterval";

export const DEFAULT_SCREEN_SHARE_STATE: ScreenShareSessionState = {
  active: false,
  sessionId: null,
  sourceType: null,
  sourceLabel: null,
  startedAt: null,
  interactive: true,
  maxViewers: 5,
  currentViewers: 0,
  streamReady: false,
  streamMessage: null,
};

function isSameScreenShareState(
  a: ScreenShareSessionState,
  b: ScreenShareSessionState,
): boolean {
  return (
    a.active === b.active &&
    a.sessionId === b.sessionId &&
    a.sourceType === b.sourceType &&
    a.sourceLabel === b.sourceLabel &&
    a.startedAt === b.startedAt &&
    a.interactive === b.interactive &&
    a.maxViewers === b.maxViewers &&
    a.currentViewers === b.currentViewers &&
    a.streamReady === b.streamReady &&
    a.streamMessage === b.streamMessage
  );
}

export function useScreenShareState(
  fetcher: () => Promise<ScreenShareSessionState>,
  pollingInterval: number | null = 3000,
) {
  const [state, setState] = useState<ScreenShareSessionState>(
    DEFAULT_SCREEN_SHARE_STATE,
  );
  const [loading, setLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(
    () => document.visibilityState === "visible",
  );

  const updateState = useCallback(async () => {
    try {
      const newState = await fetcher();
      setState((prev) =>
        isSameScreenShareState(prev, newState) ? prev : newState,
      );
    } catch {
      // In production, we might want to be less noisy or handle specific errors
      // console.warn('[useScreenShareState] Update failed:', err);
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    void updateState();
  }, [updateState]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const visible = document.visibilityState === "visible";
      setIsVisible(visible);
      if (visible) {
        void updateState();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [updateState]);

  useInterval(updateState, isVisible ? pollingInterval : null);

  return { state, setState, loading, refresh: updateState };
}
