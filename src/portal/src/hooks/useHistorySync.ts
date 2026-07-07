import { useCallback, useEffect, useRef } from "react";

const HISTORY_SYNC_INTERVAL_MS = 6000;
const HISTORY_MIN_SAVE_DELTA_SECONDS = 3;
const HISTORY_SEEK_SAVE_DELTA_SECONDS = 20;
const HISTORY_ACTIVE_WINDOW_MS = 12000;

export type SaveProgressOptions = {
  force?: boolean;
  timecode?: number;
  duration?: number;
};

type HistorySyncPayload = {
  timecode: number;
  duration: number;
  force: boolean;
};

type HistorySyncState = {
  inFlight: boolean;
  queued: HistorySyncPayload | null;
  lastSavedTime: number;
  lastSentAtMs: number;
  lastObservedTime: number;
  lastTickAtMs: number;
};

export function useHistorySync(
  vodId: string | null,
  currentTimeRef: React.MutableRefObject<number>,
  durationRef: React.MutableRefObject<number>,
  isPlaying: boolean,
  isNativeFullscreen = false,
) {
  const activeVodIdRef = useRef<string | null>(vodId);
  const historySyncRef = useRef<HistorySyncState>({
    inFlight: false,
    queued: null,
    lastSavedTime: 0,
    lastSentAtMs: 0,
    lastObservedTime: 0,
    lastTickAtMs: 0,
  });

  const dispatchHistoryPayloadRef = useRef<
    (payload: HistorySyncPayload) => void
  >(() => {});

  useEffect(() => {
    activeVodIdRef.current = vodId;
  }, [vodId]);

  const queueHistoryPayload = useCallback((payload: HistorySyncPayload) => {
    const activeVodId = activeVodIdRef.current;
    if (!activeVodId) {
      return;
    }

    const syncState = historySyncRef.current;
    if (syncState.inFlight) {
      const queued = syncState.queued;
      if (!queued) {
        syncState.queued = payload;
        return;
      }

      const changedEnough =
        Math.abs(payload.timecode - queued.timecode) >=
        HISTORY_MIN_SAVE_DELTA_SECONDS;
      if (
        payload.force ||
        changedEnough ||
        payload.timecode > queued.timecode
      ) {
        syncState.queued = payload;
      }
      return;
    }

    dispatchHistoryPayloadRef.current(payload);
  }, []);

  useEffect(() => {
    dispatchHistoryPayloadRef.current = (payload: HistorySyncPayload) => {
      const activeVodId = activeVodIdRef.current;
      if (!activeVodId) {
        return;
      }

      const syncState = historySyncRef.current;
      syncState.inFlight = true;
      syncState.lastSentAtMs = Date.now();

      fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vodId: activeVodId,
          timecode: payload.timecode,
          duration: payload.duration,
        }),
      })
        .then((res) => {
          if (!res.ok) {
            throw new Error(`History save failed (${res.status})`);
          }
          syncState.lastSavedTime = payload.timecode;
          globalThis.dispatchEvent(
            new CustomEvent("nsv:history-updated", {
              detail: {
                vodId: activeVodId,
                timecode: payload.timecode,
                duration: payload.duration,
              },
            }),
          );
        })
        .catch((error) => {
          console.error("Failed to save history", error);
        })
        .finally(() => {
          syncState.inFlight = false;

          const queued = syncState.queued;
          syncState.queued = null;

          if (!queued || !activeVodIdRef.current) {
            return;
          }

          const shouldFlushQueued =
            queued.force ||
            Math.abs(queued.timecode - syncState.lastSavedTime) >=
              HISTORY_MIN_SAVE_DELTA_SECONDS;
          if (shouldFlushQueued) {
            queueHistoryPayload(queued);
          }
        });
    };
  }, [queueHistoryPayload]);

  const saveProgress = useCallback(
    (options: SaveProgressOptions = {}) => {
      if (!activeVodIdRef.current) {
        return;
      }

      const current = Math.max(
        0,
        Number(options.timecode ?? currentTimeRef.current),
      );
      if (current <= 0) {
        return;
      }

      const dur = Math.max(
        0,
        Number(options.duration ?? durationRef.current ?? 0),
      );
      const syncState = historySyncRef.current;
      const now = Date.now();
      const elapsedMs = now - syncState.lastSentAtMs;
      const changedEnough =
        Math.abs(current - syncState.lastSavedTime) >=
        HISTORY_MIN_SAVE_DELTA_SECONDS;

      if (
        !options.force &&
        !changedEnough &&
        elapsedMs < HISTORY_SYNC_INTERVAL_MS
      ) {
        return;
      }

      queueHistoryPayload({
        timecode: current,
        duration: dur,
        force: Boolean(options.force),
      });
    },
    [queueHistoryPayload, currentTimeRef, durationRef],
  );

  const flushHistoryBeforeExit = useCallback(async () => {
    const activeVodId = activeVodIdRef.current;
    if (!activeVodId) {
      return;
    }

    const timecode = Math.max(0, Number(currentTimeRef.current || 0));
    if (timecode <= 0) {
      return;
    }

    const durationValue = Math.max(0, Number(durationRef.current || 0));

    try {
      const res = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vodId: activeVodId,
          timecode,
          duration: durationValue,
        }),
      });
      if (!res.ok) {
        throw new Error(`History save failed (${res.status})`);
      }

      historySyncRef.current.lastSavedTime = timecode;
      globalThis.dispatchEvent(
        new CustomEvent("nsv:history-updated", {
          detail: {
            vodId: activeVodId,
            timecode,
            duration: durationValue,
          },
        }),
      );
    } catch (error) {
      console.error("Failed to flush history before exit", error);
    }
  }, [currentTimeRef, durationRef]);

  // Handle intervals and page visibility
  useEffect(() => {
    if (!vodId) return;

    const intervalId = setInterval(() => {
      const syncState = historySyncRef.current;
      // During native iOS fullscreen, React may throttle state updates
      // causing lastTickAtMs to become stale. Bypass the staleness check
      // when the player is in native fullscreen and actively playing.
      const isActiveNativeFullscreen = isNativeFullscreen;
      if (
        !isActiveNativeFullscreen &&
        Date.now() - syncState.lastTickAtMs > HISTORY_ACTIVE_WINDOW_MS
      ) {
        return;
      }
      if (isActiveNativeFullscreen) {
        // Directly read from the ref since React state updates may be throttled.
        saveProgress({ timecode: currentTimeRef.current });
      } else {
        saveProgress();
      }
    }, HISTORY_SYNC_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [saveProgress, vodId, isNativeFullscreen, currentTimeRef]);

  useEffect(() => {
    if (!vodId) return;
    if (isPlaying) return;
    saveProgress({ force: true });
  }, [isPlaying, saveProgress, vodId]);

  useEffect(() => {
    if (!vodId) return;

    const flushProgressOnHide = () => {
      if (document.visibilityState === "hidden") {
        saveProgress({ force: true });
      }
    };

    const flushProgressOnPageHide = () => {
      saveProgress({ force: true });
    };

    document.addEventListener("visibilitychange", flushProgressOnHide);
    globalThis.addEventListener("pagehide", flushProgressOnPageHide);

    return () => {
      document.removeEventListener("visibilitychange", flushProgressOnHide);
      globalThis.removeEventListener("pagehide", flushProgressOnPageHide);
      saveProgress({ force: true });
    };
  }, [saveProgress, vodId]);

  const updateObservedTime = useCallback(
    (time: number) => {
      const syncState = historySyncRef.current;
      const previousObserved = syncState.lastObservedTime;
      syncState.lastObservedTime = time;
      syncState.lastTickAtMs = Date.now();

      if (
        previousObserved > 0 &&
        Math.abs(time - previousObserved) >= HISTORY_SEEK_SAVE_DELTA_SECONDS
      ) {
        saveProgress({
          force: true,
          timecode: time,
        });
      }
    },
    [saveProgress],
  );

  return {
    historySyncRef,
    saveProgress,
    flushHistoryBeforeExit,
    updateObservedTime,
  };
}
