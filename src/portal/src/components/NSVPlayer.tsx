import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MediaPlayer,
  MediaProvider,
  useMediaRemote,
  useMediaStore,
} from "@vidstack/react";
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
} from "@vidstack/react/player/layouts/default";
import type Hls from "hls.js";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import {} from "../utils/authTokens";
import {
  canPlayHlsNatively,
  canUseHlsJs,
  isMobileDevice,
  isTauriRuntime,
} from "../utils/capabilities";
import {
  BASE_STALL_RECOVERY_THRESHOLD_MS,
  NATIVE_HLS_STALL_RECOVERY_THRESHOLD_MS,
  NATIVE_VOD_SOURCE_REFRESH_INTERVAL_MS,
  NATIVE_VOD_SOURCE_REFRESH_CHECK_MS,
  getHlsStabilityConfig,
  loadHlsLightLibrary,
  hasFixedQualityPreference,
  setHlsLevelMode,
  InternalApiHlsLoader,
  inferRequestedQualityValueFromEntry,
  sortedQualitiesByHeightDesc,
  resolveRequestedQuality,
  withAuthQuery,
  withTransientQuery,
} from "./player/nsvPlayerHelpers";

export type NSVMediaSource = {
  src: string;
  type?: string;
};

type NSVTextTrack = {
  src: string;
  kind: "subtitles" | "captions" | "chapters" | "descriptions" | "metadata";
  label: string;
  language: string;
  default?: boolean;
};

type NSVPlayerProps = {
  source: NSVMediaSource;
  title: string;
  poster?: string;
  streamType?: "on-demand" | "live" | "ll-live";
  autoPlay?: boolean;
  muted?: boolean;
  startTime?: number;
  seekTo?: number | null;
  defaultQuality?: string;
  isMobileLayout?: boolean;
  isLandscape?: boolean;
  className?: string;
  textTracks?: NSVTextTrack[];
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onQualitySelection?: (quality: string) => void;
  onSourceReady?: (sourceUrl: string) => void;
  onError?: (message: string) => void;
  onFullscreenChange?: (isFullscreen: boolean) => void;
};

// Extracted helpers
type WebkitPresentationVideo = HTMLVideoElement & {
  webkitPresentationMode?: string;
  webkitSetPresentationMode?: (
    mode: "inline" | "fullscreen" | "picture-in-picture",
  ) => void;
};

const NSVPlayer = React.memo(
  ({
    source,
    title,
    poster,
    streamType = "on-demand",
    autoPlay = false,
    muted = false,
    startTime,
    seekTo,
    defaultQuality,
    isMobileLayout: _isMobileLayout = false,
    isLandscape = false,
    className,
    textTracks = [],
    onTimeUpdate,
    onDurationChange,
    onPlayStateChange,
    onQualitySelection,
    onSourceReady,
    onError,
    onFullscreenChange,
  }: NSVPlayerProps) => {
    const playerRef = useRef<any>(null);
    const store = useMediaStore(playerRef);
    const remote = useMediaRemote(playerRef);

    const remoteRef = useRef(remote);
    const storeRef = useRef(store);
    useEffect(() => {
      remoteRef.current = remote;
      storeRef.current = store;
    }, [remote, store]);

    const didSeekOnStartRef = useRef(false);
    const lastExternalSeekRef = useRef<number | null>(null);
    const didApplyDefaultQualityRef = useRef(false);
    const hlsInstanceRef = useRef<Hls | null>(null);
    const pendingResumeSeekRef = useRef<number | null>(null);
    const pendingResumePlayRef = useRef(false);
    const wasBackgroundedRef = useRef(false);
    const internalQualityRequestRef = useRef(false);
    const qualityLockEnabledRef = useRef(false);
    const lockedQualityIndexRef = useRef<number | null>(null);
    const lastLockAttemptAtRef = useRef(0);
    const lastReadySourceRef = useRef<string | null>(null);
    const lastRecoveryAtRef = useRef(0);
    const recoveryWindowStartedAtRef = useRef(0);
    const recoveryAttemptsInWindowRef = useRef(0);
    const lastPlaybackProgressRef = useRef({ time: 0, observedAt: Date.now() });
    const lastNativeVodRefreshAtRef = useRef(Date.now());
    const nativeFullscreenActiveRef = useRef(false);
    const nativeFullscreenEndedAtRef = useRef(0);
    const [resumeRevision, setResumeRevision] = useState(0);

    useEffect(() => {
      if (isLandscape && _isMobileLayout && remote) {
        remote.enterFullscreen();
      }
    }, [isLandscape, _isMobileLayout, remote]);

    // Track native iOS fullscreen via webkit events on the <video> element.
    // These events fire for AVPlayer fullscreen which is distinct from the
    // standard Fullscreen API (document.fullscreenElement).
    useEffect(() => {
      const getVideoElement = (): HTMLVideoElement | null => {
        const playerRoot = (playerRef.current?.el ?? playerRef.current) as any;
        if (playerRoot && typeof playerRoot.querySelector === "function") {
          return playerRoot.querySelector("video") ?? null;
        }
        return null;
      };

      let videoEl: HTMLVideoElement | null = null;

      const onBeginFullscreen = () => {
        nativeFullscreenActiveRef.current = true;
        onFullscreenChange?.(true);
      };

      const onEndFullscreen = () => {
        nativeFullscreenActiveRef.current = false;
        nativeFullscreenEndedAtRef.current = Date.now();
        // Reset backgrounded flag so the visibility handlers don't trigger
        // a false source recovery when the webview becomes visible again.
        wasBackgroundedRef.current = false;
        onFullscreenChange?.(false);
      };

      // The <video> element may not exist at mount — observe the player root
      // and attach listeners once the video element appears.
      const tryAttach = () => {
        videoEl = getVideoElement();
        if (!videoEl) return false;
        videoEl.addEventListener("webkitbeginfullscreen", onBeginFullscreen);
        videoEl.addEventListener("webkitendfullscreen", onEndFullscreen);
        return true;
      };

      if (!tryAttach()) {
        // Retry after a short delay to handle async provider setup.
        const retryId = setTimeout(tryAttach, 500);
        const retryId2 = setTimeout(tryAttach, 1500);
        return () => {
          clearTimeout(retryId);
          clearTimeout(retryId2);
          if (videoEl) {
            videoEl.removeEventListener(
              "webkitbeginfullscreen",
              onBeginFullscreen,
            );
            videoEl.removeEventListener("webkitendfullscreen", onEndFullscreen);
          }
        };
      }

      return () => {
        if (videoEl) {
          videoEl.removeEventListener(
            "webkitbeginfullscreen",
            onBeginFullscreen,
          );
          videoEl.removeEventListener("webkitendfullscreen", onEndFullscreen);
        }
      };
    }, [onFullscreenChange]);

    const useNativeResumeRefresh =
      isMobileDevice() && canPlayHlsNatively() && !canUseHlsJs();

    const queueSourceRefreshAndResume = useCallback((reason: string) => {
      const now = Date.now();
      if (now - lastRecoveryAtRef.current < 2500) {
        return false;
      }

      if (
        recoveryWindowStartedAtRef.current <= 0 ||
        now - recoveryWindowStartedAtRef.current > 120_000
      ) {
        recoveryWindowStartedAtRef.current = now;
        recoveryAttemptsInWindowRef.current = 0;
      }

      if (recoveryAttemptsInWindowRef.current >= 6) {
        return false;
      }

      recoveryAttemptsInWindowRef.current += 1;
      lastRecoveryAtRef.current = now;

      const mediaState = storeRef.current as any;
      const currentTime = Number(mediaState.currentTime || 0);
      const canSeek =
        Boolean(mediaState.canSeek) && Number(mediaState.duration || 0) > 0;

      pendingResumeSeekRef.current =
        canSeek && Number.isFinite(currentTime)
          ? Math.max(0, currentTime)
          : null;
      pendingResumePlayRef.current = !mediaState.paused;

      if (Number.isFinite(currentTime)) {
        lastPlaybackProgressRef.current = {
          time: Math.max(0, currentTime),
          observedAt: now,
        };
      }

      setResumeRevision((prev) => prev + 1);

      console.warn("[NSVPlayer] Triggering source recovery refresh", {
        reason,
      });

      return true;
    }, []);

    const src = useMemo(() => {
      let resolvedSrc = withAuthQuery(source.src);
      if (resumeRevision > 0) {
        resolvedSrc = withTransientQuery(
          resolvedSrc,
          "_resume",
          String(resumeRevision),
        );
      }

      return {
        src: resolvedSrc,
        type: source.type,
      };
    }, [source.src, source.type, resumeRevision]);

    const exitPictureInPictureIfNeeded = useCallback(() => {
      const doc = document as Document & {
        pictureInPictureElement?: Element | null;
        exitPictureInPicture?: () => Promise<void>;
      };

      if (
        typeof doc.exitPictureInPicture === "function" &&
        doc.pictureInPictureElement
      ) {
        void doc.exitPictureInPicture().catch(() => {
          // Ignore when PiP is already detached while the view is unmounting.
        });
      }

      const playerRoot = (playerRef.current?.el ?? playerRef.current) as any;
      const activeVideo =
        playerRoot && typeof playerRoot.querySelector === "function"
          ? playerRoot.querySelector("video")
          : null;
      const webkitVideo = activeVideo as WebkitPresentationVideo | null;

      if (
        webkitVideo &&
        typeof webkitVideo.webkitSetPresentationMode === "function" &&
        webkitVideo.webkitPresentationMode === "picture-in-picture"
      ) {
        void Promise.resolve()
          .then(() => {
            webkitVideo.webkitSetPresentationMode?.("inline");
          })
          .catch(() => {
            // Ignore WebKit-specific transition errors during teardown.
          });
      }
    }, []);

    useEffect(() => {
      return () => {
        exitPictureInPictureIfNeeded();
      };
    }, [exitPictureInPictureIfNeeded]);

    const effectiveMuted = muted || (autoPlay && isMobileDevice());

    useEffect(() => {
      if (!onTimeUpdate) return;
      onTimeUpdate(store.currentTime || 0);
    }, [store.currentTime, onTimeUpdate]);

    useEffect(() => {
      if (!onDurationChange) return;
      onDurationChange(store.duration || 0);
    }, [store.duration, onDurationChange]);

    useEffect(() => {
      if (!onPlayStateChange) return;
      onPlayStateChange(!store.paused);
    }, [store.paused, onPlayStateChange]);

    useEffect(() => {
      if (!onError || !store.error) return;
      onError(store.error.message || "Playback failed.");
    }, [store.error, onError]);

    useEffect(() => {
      if (!store.error) return;

      const isHls = (src.type || "").toLowerCase().includes("mpegurl");
      if (!isHls) return;

      queueSourceRefreshAndResume("store-error");
    }, [queueSourceRefreshAndResume, src.type, store.error]);

    useEffect(() => {
      if (!onError) return;
      const isHls = (src.type || "").toLowerCase().includes("mpegurl");
      if (!isHls) return;

      if (!canUseHlsJs() && !canPlayHlsNatively()) {
        onError("This browser cannot play HLS streams on this device.");
      }
    }, [onError, src.type]);

    useEffect(() => {
      const now = Date.now();
      const currentTime = Number(store.currentTime || 0);

      if (Number.isFinite(currentTime)) {
        const previous = lastPlaybackProgressRef.current;
        if (Math.abs(currentTime - previous.time) >= 0.2) {
          lastPlaybackProgressRef.current = {
            time: currentTime,
            observedAt: now,
          };
          return;
        }
      }

      const mediaState = store as any;
      if (mediaState.paused || mediaState.ended || mediaState.seeking) {
        lastPlaybackProgressRef.current.observedAt = now;
      }
    }, [store, store.currentTime, store.paused]);

    useEffect(() => {
      const isHls = (src.type || "").toLowerCase().includes("mpegurl");
      if (!isHls) return;

      const isNativeHlsPlayback = useNativeResumeRefresh;
      const stagnantThresholdMs = isNativeHlsPlayback
        ? NATIVE_HLS_STALL_RECOVERY_THRESHOLD_MS
        : BASE_STALL_RECOVERY_THRESHOLD_MS;

      const intervalId = globalThis.setInterval(() => {
        const mediaState = storeRef.current as any;
        if (!mediaState) return;

        let isNativeFullscreen = false;
        try {
          const playerRoot = (playerRef.current?.el ??
            playerRef.current) as any;
          const activeVideo = (
            playerRoot && typeof playerRoot.querySelector === "function"
              ? playerRoot.querySelector("video")
              : null
          ) as any;
          isNativeFullscreen = Boolean(activeVideo?.webkitDisplayingFullscreen);
        } catch {
          // Ignore
        }

        if (document.visibilityState === "hidden" && !isNativeFullscreen)
          return;
        if (mediaState.paused || mediaState.ended) return;
        if (!mediaState.canPlay && !isNativeHlsPlayback) return;
        if (mediaState.seeking) return;

        const stagnantMs =
          Date.now() - lastPlaybackProgressRef.current.observedAt;
        if (stagnantMs < stagnantThresholdMs) return;

        const reason = mediaState.waiting
          ? "playback-waiting-stall"
          : "playback-stall";
        queueSourceRefreshAndResume(
          isNativeHlsPlayback ? `${reason}-native` : reason,
        );
      }, 3000);

      return () => {
        globalThis.clearInterval(intervalId);
      };
    }, [queueSourceRefreshAndResume, src.type, useNativeResumeRefresh]);

    useEffect(() => {
      const isHls = (src.type || "").toLowerCase().includes("mpegurl");
      if (!isHls) return;
      if (!useNativeResumeRefresh) return;
      if (streamType !== "on-demand") return;

      const intervalId = globalThis.setInterval(() => {
        const mediaState = storeRef.current as any;
        if (!mediaState) return;
        if (document.visibilityState === "hidden") return;
        if (mediaState.paused || mediaState.ended || mediaState.seeking) {
          return;
        }

        const now = Date.now();
        if (
          now - lastNativeVodRefreshAtRef.current <
          NATIVE_VOD_SOURCE_REFRESH_INTERVAL_MS
        ) {
          return;
        }

        const queued = queueSourceRefreshAndResume("native-vod-token-rotation");
        if (queued) {
          lastNativeVodRefreshAtRef.current = now;
        }
      }, NATIVE_VOD_SOURCE_REFRESH_CHECK_MS);

      return () => {
        globalThis.clearInterval(intervalId);
      };
    }, [
      queueSourceRefreshAndResume,
      src.type,
      streamType,
      useNativeResumeRefresh,
    ]);

    useEffect(() => {
      if (didSeekOnStartRef.current) return;
      if (!Number.isFinite(startTime) || (startTime || 0) <= 0) return;
      if (!store.canSeek || store.duration <= 0) return;

      didSeekOnStartRef.current = true;
      remote.seek(Math.max(0, startTime || 0));
    }, [startTime, store.canSeek, store.duration, remote]);

    useEffect(() => {
      if (!useNativeResumeRefresh) return;

      const FULLSCREEN_EXIT_GRACE_MS = 2000;

      const getIsNativeFullscreen = () => {
        // Prefer the ref tracked via webkitbeginfullscreen/webkitendfullscreen
        // events, which is more reliable than polling webkitDisplayingFullscreen.
        if (nativeFullscreenActiveRef.current) return true;
        try {
          const playerRoot = (playerRef.current?.el ??
            playerRef.current) as any;
          const activeVideo = (
            playerRoot && typeof playerRoot.querySelector === "function"
              ? playerRoot.querySelector("video")
              : null
          ) as any;
          if (
            activeVideo &&
            typeof activeVideo.webkitSetPresentationMode === "function"
          ) {
            return Boolean(activeVideo.webkitDisplayingFullscreen);
          }
          return false;
        } catch {
          return false;
        }
      };

      const isWithinFullscreenExitGrace = () => {
        const endedAt = nativeFullscreenEndedAtRef.current;
        return endedAt > 0 && Date.now() - endedAt < FULLSCREEN_EXIT_GRACE_MS;
      };

      const onVisibilityChange = () => {
        if (document.visibilityState === "hidden") {
          if (!getIsNativeFullscreen()) {
            wasBackgroundedRef.current = true;
          }
          return;
        }

        // Skip recovery if we just exited native fullscreen — the webview
        // is becoming visible again but the stream is still active.
        if (isWithinFullscreenExitGrace()) {
          wasBackgroundedRef.current = false;
          return;
        }

        if (wasBackgroundedRef.current) {
          wasBackgroundedRef.current = false;
          // Each foreground is a fresh recovery opportunity: reset the window
          // so a previous burst of background/foreground cycles does not
          // permanently block recovery until the 120-second window expires.
          recoveryWindowStartedAtRef.current = 0;
          recoveryAttemptsInWindowRef.current = 0;
          queueSourceRefreshAndResume("visibility-resume");
        }
      };

      const onPageHide = () => {
        if (!getIsNativeFullscreen()) {
          wasBackgroundedRef.current = true;
        }
      };

      const onPageShowOrFocus = () => {
        // Skip recovery if we just exited native fullscreen.
        if (isWithinFullscreenExitGrace()) {
          wasBackgroundedRef.current = false;
          return;
        }

        if (!wasBackgroundedRef.current) return;
        wasBackgroundedRef.current = false;
        recoveryWindowStartedAtRef.current = 0;
        recoveryAttemptsInWindowRef.current = 0;
        queueSourceRefreshAndResume("pageshow-focus");
      };

      document.addEventListener("visibilitychange", onVisibilityChange);
      globalThis.addEventListener("pagehide", onPageHide);
      globalThis.addEventListener("pageshow", onPageShowOrFocus);
      globalThis.addEventListener("focus", onPageShowOrFocus);

      return () => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        globalThis.removeEventListener("pagehide", onPageHide);
        globalThis.removeEventListener("pageshow", onPageShowOrFocus);
        globalThis.removeEventListener("focus", onPageShowOrFocus);
      };
    }, [queueSourceRefreshAndResume, useNativeResumeRefresh]);

    useEffect(() => {
      const hasPendingSeek = pendingResumeSeekRef.current !== null;
      const hasPendingPlay = pendingResumePlayRef.current;

      if (!hasPendingSeek && !hasPendingPlay) {
        return;
      }

      if (hasPendingSeek && (!store.canSeek || store.duration <= 0)) {
        return;
      }

      const nextSeek = pendingResumeSeekRef.current;
      const shouldPlay = pendingResumePlayRef.current;

      pendingResumeSeekRef.current = null;
      pendingResumePlayRef.current = false;

      if (nextSeek !== null) {
        remote.seek(nextSeek);
      }

      if (shouldPlay) {
        remote.play();
      }
    }, [remote, store.canSeek, store.duration]);

    useEffect(() => {
      didSeekOnStartRef.current = false;
      lastExternalSeekRef.current = null;
      didApplyDefaultQualityRef.current = false;
      pendingResumeSeekRef.current = null;
      pendingResumePlayRef.current = false;
      internalQualityRequestRef.current = false;
      qualityLockEnabledRef.current = false;
      lockedQualityIndexRef.current = null;
      lastLockAttemptAtRef.current = 0;
      lastReadySourceRef.current = null;
      lastRecoveryAtRef.current = 0;
      recoveryWindowStartedAtRef.current = 0;
      recoveryAttemptsInWindowRef.current = 0;
      lastPlaybackProgressRef.current = { time: 0, observedAt: Date.now() };
      lastNativeVodRefreshAtRef.current = Date.now();

      if (hlsInstanceRef.current) {
        try {
          hlsInstanceRef.current.stopLoad();
          hlsInstanceRef.current.detachMedia();
        } catch {
          // Ignore cleanup failures on stale instances.
        }
        hlsInstanceRef.current = null;
      }
    }, [source.src, source.type]);

    useEffect(() => {
      didApplyDefaultQualityRef.current = false;
    }, [defaultQuality, streamType]);

    useEffect(() => {
      if (!onSourceReady) return;
      if (!store.canPlay) return;
      if (lastReadySourceRef.current === source.src) return;

      lastReadySourceRef.current = source.src;
      onSourceReady(source.src);
    }, [onSourceReady, source.src, store.canPlay]);

    const applyQualitySelection = useCallback(
      (qualityIdx: number) => {
        if (!Number.isFinite(qualityIdx) || qualityIdx < 0) return;

        internalQualityRequestRef.current = true;
        try {
          remote.changeQuality(qualityIdx);
          if (hlsInstanceRef.current) {
            setHlsLevelMode(hlsInstanceRef.current, qualityIdx);
          }
        } finally {
          queueMicrotask(() => {
            internalQualityRequestRef.current = false;
          });
        }
      },
      [remote],
    );

    useEffect(() => {
      if (!Number.isFinite(seekTo)) return;
      if (!store.canSeek || store.duration <= 0) return;

      const nextValue = Math.max(0, seekTo || 0);
      if (
        lastExternalSeekRef.current !== null &&
        Math.abs(lastExternalSeekRef.current - nextValue) < 0.01
      ) {
        return;
      }

      lastExternalSeekRef.current = nextValue;
      remote.seek(nextValue);
    }, [seekTo, store.canSeek, store.duration, remote]);

    useEffect(() => {
      if (didApplyDefaultQualityRef.current) return;
      if (!store.canSetQuality) return;
      if (!store.qualities || store.qualities.length === 0) return;
      if (streamType !== "on-demand") {
        didApplyDefaultQualityRef.current = true;
        return;
      }

      try {
        const hasFixedPreference = hasFixedQualityPreference(defaultQuality);
        const sorted = sortedQualitiesByHeightDesc(store.qualities as any[]);
        const qualityIdx = resolveRequestedQuality(sorted, defaultQuality);

        if (qualityIdx < 0) {
          if (hlsInstanceRef.current) {
            setHlsLevelMode(hlsInstanceRef.current, -1);
          }
          if (!hasFixedPreference) {
            qualityLockEnabledRef.current = false;
            lockedQualityIndexRef.current = null;
          }
          didApplyDefaultQualityRef.current = true;
          return;
        }

        applyQualitySelection(qualityIdx);
        if (hasFixedPreference) {
          qualityLockEnabledRef.current = true;
          lockedQualityIndexRef.current = qualityIdx;
        }
        didApplyDefaultQualityRef.current = true;
      } catch (error) {
        didApplyDefaultQualityRef.current = false;
        console.error("[NSVPlayer] Failed to apply default quality", error);
      }
    }, [
      defaultQuality,
      applyQualitySelection,
      store.canSetQuality,
      store.qualities,
      streamType,
    ]);

    useEffect(() => {
      if (streamType !== "on-demand") return;
      if (!qualityLockEnabledRef.current) return;
      if (!store.canPlay) return;

      const lockedIdx = lockedQualityIndexRef.current;
      if (lockedIdx === null || lockedIdx < 0) return;
      if (!store.canSetQuality) return;
      if (!store.qualities || store.qualities.length === 0) return;
      if (lockedIdx >= store.qualities.length) return;

      const qualities = store.qualities as Array<{ id?: string }>;
      const selectedQuality = store.quality as { id?: string } | null;
      const selectedId = selectedQuality?.id;
      const lockedId = qualities[lockedIdx]?.id;

      const shouldRestoreLock =
        Boolean(store.autoQuality) ||
        !selectedId ||
        (typeof lockedId === "string" && lockedId !== selectedId);

      if (!shouldRestoreLock) return;

      const now = Date.now();
      if (now - lastLockAttemptAtRef.current < 350) return;
      lastLockAttemptAtRef.current = now;
      applyQualitySelection(lockedIdx);
    }, [
      applyQualitySelection,
      store.autoQuality,
      store.canPlay,
      store.canSetQuality,
      store.qualities,
      store.quality,
      streamType,
    ]);

    const handleQualityChangeRequest = useCallback(
      (event: any) => {
        if (streamType !== "on-demand") return;
        if (internalQualityRequestRef.current) return;

        const requestedIndex = Number(event?.detail);
        if (!Number.isFinite(requestedIndex)) return;

        if (requestedIndex >= 0) {
          qualityLockEnabledRef.current = true;
          lockedQualityIndexRef.current = requestedIndex;

          if (onQualitySelection) {
            const qualities =
              (storeRef.current.qualities as Array<
                { id?: string; label?: string; height?: number } | undefined
              >) || [];
            const selectedEntry = qualities[requestedIndex];
            const requestedQuality =
              inferRequestedQualityValueFromEntry(selectedEntry);
            if (requestedQuality) {
              onQualitySelection(requestedQuality);
            }
          }
          return;
        }

        if (onQualitySelection) {
          onQualitySelection("auto");
        }

        if (!qualityLockEnabledRef.current) return;

        const lockedIdx = lockedQualityIndexRef.current;
        if (lockedIdx === null || lockedIdx < 0) return;

        queueMicrotask(() => {
          applyQualitySelection(lockedIdx);
        });
      },
      [applyQualitySelection, onQualitySelection, streamType],
    );

    const handleQualityChange = useCallback(
      (event: any) => {
        if (streamType !== "on-demand") return;
        if (!qualityLockEnabledRef.current) return;
        if (internalQualityRequestRef.current) return;

        const quality = event?.detail as { id?: string } | null | undefined;
        const qualityId = quality?.id;
        if (!qualityId) return;

        const knownQualities =
          (storeRef.current.qualities as Array<{ id?: string }>) || [];
        const qualityIdx = knownQualities.findIndex((entry) => {
          return entry?.id === qualityId;
        });

        if (qualityIdx >= 0) {
          lockedQualityIndexRef.current = qualityIdx;
        }
      },
      [streamType],
    );

    const handleHlsInstance = useCallback((instance: Hls) => {
      hlsInstanceRef.current = instance;
    }, []);

    const handleRemoteControl = useCallback((event: any) => {
      const payload = event.payload;
      const cmd = payload.command;
      const val = payload.value ?? 0;

      const r = remoteRef.current;
      const s = storeRef.current;

      switch (cmd) {
        case "play":
          r.play();
          break;
        case "pause":
          r.pause();
          break;
        case "seek":
          r.seek(Math.max(0, Math.min(s.duration, (s.currentTime || 0) + val)));
          break;
        case "volume":
          r.changeVolume(val);
          break;
        case "mute":
          r.toggleMuted();
          break;
      }
    }, []);

    useEffect(() => {
      const onPlay = () => remoteRef.current.play();
      const onPause = () => remoteRef.current.pause();
      const onSeek = (e: any) => {
        const val = e.detail?.value || 0;
        const s = storeRef.current;
        remoteRef.current.seek(
          Math.max(0, Math.min(s.duration, (s.currentTime || 0) + val)),
        );
      };
      const onVolume = (e: any) =>
        remoteRef.current.changeVolume(e.detail?.value ?? 1);
      const onMute = () => remoteRef.current.toggleMuted();

      globalThis.addEventListener("nsv-remote-play", onPlay);
      globalThis.addEventListener("nsv-remote-pause", onPause);
      globalThis.addEventListener("nsv-remote-seek", onSeek);
      globalThis.addEventListener("nsv-remote-volume", onVolume);
      globalThis.addEventListener("nsv-remote-mute", onMute);

      let unlisten: (() => void) | undefined;
      const isTauri =
        (globalThis as any).__TAURI_INTERNALS__ ||
        (globalThis as any).__TAURI__;

      if (isTauri) {
        const setupTauriListener = async () => {
          try {
            const { listen } = await import("@tauri-apps/api/event");
            unlisten = await listen("nsv-control", handleRemoteControl);
          } catch (err) {
            console.error("[NSVPlayer] Failed to load Tauri event API:", err);
          }
        };
        void setupTauriListener();
      }

      return () => {
        globalThis.removeEventListener("nsv-remote-play", onPlay);
        globalThis.removeEventListener("nsv-remote-pause", onPause);
        globalThis.removeEventListener("nsv-remote-seek", onSeek);
        globalThis.removeEventListener("nsv-remote-volume", onVolume);
        globalThis.removeEventListener("nsv-remote-mute", onMute);
        if (unlisten) unlisten();
      };
    }, [handleRemoteControl]);

    const onProviderChange = useCallback(
      (provider: any) => {
        if (provider?.type === "hls") {
          if (!canUseHlsJs()) return;
          provider.library = loadHlsLightLibrary;
          const hlsConfig = getHlsStabilityConfig(
            hasFixedQualityPreference(defaultQuality),
          );
          const loaderConfig = isTauriRuntime()
            ? { loader: InternalApiHlsLoader }
            : {};
          provider.config = provider.config
            ? { ...provider.config, ...hlsConfig, ...loaderConfig }
            : { ...hlsConfig, ...loaderConfig };
        }
      },
      [defaultQuality],
    );

    const renderedTextTracks = useMemo(
      () =>
        textTracks.map((track: any) => (
          <track
            key={`${track.kind}-${track.language}-${track.label}`}
            src={withAuthQuery(track.src)}
            kind={track.kind as any}
            label={track.label}
            srcLang={track.language}
            default={track.default}
          />
        )),
      [textTracks],
    );

    return (
      <MediaPlayer
        onProviderChange={onProviderChange}
        onHlsInstance={handleHlsInstance}
        onMediaQualityChangeRequest={handleQualityChangeRequest}
        onQualityChange={handleQualityChange}
        ref={playerRef}
        className={className}
        title={title}
        src={src as any}
        viewType="video"
        poster={poster}
        streamType={streamType}
        load={streamType === "on-demand" ? "eager" : "visible"}
        preload="metadata"
        autoPlay={autoPlay}
        muted={effectiveMuted}
        playsInline
        keyTarget="player"
        keyShortcuts={{
          togglePaused: "k Space",
          toggleMuted: "m",
          toggleFullscreen: "f",
          togglePictureInPicture: "i",
          toggleCaptions: "c",
          seekBackward: "ArrowLeft",
          seekForward: "ArrowRight",
          volumeUp: "ArrowUp",
          volumeDown: "ArrowDown",
        }}
        aspectRatio="16/9"
        crossOrigin="anonymous"
      >
        <MediaProvider>{renderedTextTracks}</MediaProvider>
        <DefaultVideoLayout icons={defaultLayoutIcons} />
      </MediaPlayer>
    );
  },
);

NSVPlayer.displayName = "NSVPlayer";
export default NSVPlayer;
