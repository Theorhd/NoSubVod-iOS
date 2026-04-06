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
import Hls from "hls.js/dist/hls.light.js";
import { safeStorageGet } from "../../../shared/utils/storage";
import {
  getActiveToken,
  getDeviceId,
  getRemoteServerToken,
} from "../utils/authTokens";
import {
  canPlayHlsNatively,
  canUseHlsJs,
  isMobileDevice,
} from "../utils/capabilities";

function getHlsStabilityConfig(lockToFixedQuality: boolean) {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    startLevel: -1,
    // When quality is explicitly requested (e.g. 1080p), avoid size-based capping.
    capLevelToPlayerSize: !lockToFixedQuality,
    maxBufferLength: 4,
    maxMaxBufferLength: 6,
    backBufferLength: 0,
    maxBufferSize: 6 * 1000 * 1000,
    maxBufferHole: 0.5,
    manifestLoadingTimeOut: 20000,
    levelLoadingTimeOut: 20000,
    fragLoadingTimeOut: 25000,
    nudgeMaxRetry: 8,
    abrEwmaDefaultEstimate: 24_000_000,
  };
}

function hasFixedQualityPreference(
  defaultQuality: string | undefined,
): boolean {
  return Boolean(defaultQuality && defaultQuality !== "auto");
}

function setHlsLevelMode(instance: Hls, level: number) {
  try {
    instance.currentLevel = level;
    instance.nextLevel = level;
    instance.loadLevel = level;
  } catch {
    // Ignore runtime constraints from stale/tearing down instances.
  }
}

function isTauriRuntime(): boolean {
  return Boolean(
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
}

function normalizePlaylistText(raw: string): string {
  let text = raw.replaceAll(/\r\n?/g, "\n");
  if (text.codePointAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  text = text.trimStart();

  if (text.startsWith("#EXTM3U")) {
    return text;
  }

  // Some upstream manifests can miss the EXTM3U prolog while still being valid HLS tags.
  if (text.includes("#EXT-X-") || text.includes("#EXTINF:")) {
    return `#EXTM3U\n${text}`;
  }

  return text;
}

class InternalApiHlsLoader {
  private abortController: AbortController | null = null;

  public destroy() {
    this.abort();
  }

  public abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  public load(context: any, _config: any, callbacks: any) {
    const startedAt = performance.now();
    this.abortController = new AbortController();

    const headers = new Headers();
    if (
      Number.isFinite(context.rangeStart) &&
      Number.isFinite(context.rangeEnd) &&
      context.rangeEnd >= context.rangeStart
    ) {
      headers.set("Range", `bytes=${context.rangeStart}-${context.rangeEnd}`);
    }

    fetch(context.url, {
      method: "GET",
      headers,
      signal: this.abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok && response.status !== 206) {
          callbacks.onError(
            {
              code: response.status,
              text: `HLS load failed (${response.status})`,
            },
            context,
            null,
            undefined,
          );
          return;
        }

        const loadedAt = performance.now();
        const stats = {
          aborted: false,
          loaded: 0,
          retry: 0,
          total: Number(response.headers.get("content-length") || 0),
          chunkCount: 1,
          bwEstimate: 0,
          trequest: startedAt,
          tfirst: loadedAt,
          tload: loadedAt,
        };

        const isBinary = context.responseType === "arraybuffer";
        if (isBinary) {
          const data = await response.arrayBuffer();
          stats.loaded = data.byteLength;
          stats.total = stats.total || data.byteLength;
          stats.tload = performance.now();
          callbacks.onSuccess(
            { url: context.url, data },
            stats,
            context,
            response,
          );
          return;
        }

        let data = await response.text();
        const contentType =
          response.headers.get("content-type")?.toLowerCase() || "";
        const isPlaylistRequest =
          String(context.url || "")
            .toLowerCase()
            .includes(".m3u8") ||
          contentType.includes("mpegurl") ||
          contentType.includes("vnd.apple.mpegurl");

        if (typeof data === "string" && isPlaylistRequest) {
          data = normalizePlaylistText(data);
          if (!data.startsWith("#EXTM3U")) {
            const preview = data.slice(0, 180).replaceAll(/\s+/g, " ");
            callbacks.onError(
              {
                code: response.status,
                text: `Invalid HLS manifest body for ${context.url} (preview: ${preview || "<empty>"})`,
              },
              context,
              null,
              response,
            );
            return;
          }
        } else if (typeof data === "string" && data.codePointAt(0) === 0xfeff) {
          data = data.slice(1);
        }
        stats.loaded = data.length;
        stats.total = stats.total || data.length;
        stats.tload = performance.now();
        callbacks.onSuccess(
          { url: context.url, data },
          stats,
          context,
          response,
        );
      })
      .catch((error) => {
        if (this.abortController?.signal.aborted) {
          return;
        }
        callbacks.onError(
          {
            code: 0,
            text: error instanceof Error ? error.message : String(error),
          },
          context,
          error,
          undefined,
        );
      });
  }
}

type QualityEntry = {
  idx: number;
  height: number;
};

function inferRequestedQualityValueFromEntry(entry: any): string | null {
  const height = Number((entry as { height?: number })?.height || 0);
  if (Number.isFinite(height) && height > 0) {
    return String(Math.round(height));
  }

  const label = String(
    (entry as { id?: string; label?: string })?.id ||
      (entry as { label?: string })?.label ||
      "",
  ).toLowerCase();

  if (!label) {
    return null;
  }

  if (label.includes("auto")) {
    return "auto";
  }

  const maybeDigits = label
    .split(/\D+/)
    .find((chunk) => chunk && chunk.length > 0);

  return maybeDigits || null;
}

function sortedQualitiesByHeightDesc(qualities: any[]): QualityEntry[] {
  return qualities
    .map((q, idx) => ({
      idx,
      height: Number((q as { height?: number }).height || 0),
    }))
    .filter((q) => q.height > 0)
    .sort((a, b) => b.height - a.height);
}

function resolveRequestedQuality(
  sorted: QualityEntry[],
  defaultQuality: string | undefined,
): number {
  if (sorted.length === 0) {
    return -1;
  }

  if (!defaultQuality || defaultQuality === "auto") {
    return -1;
  }

  const requestedHeight = Number.parseInt(defaultQuality, 10);
  if (Number.isNaN(requestedHeight)) {
    return -1;
  }

  const exact = sorted.find((quality) => quality.height === requestedHeight);
  if (exact) return exact.idx;

  const closestBelow = sorted.find(
    (quality) => quality.height < requestedHeight,
  );
  if (closestBelow) return closestBelow.idx;

  return sorted[sorted.length - 1]?.idx ?? -1;
}

export type NSVMediaSource = {
  src: string;
  type?: string;
};

export type NSVTextTrack = {
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
  className?: string;
  textTracks?: NSVTextTrack[];
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onQualitySelection?: (quality: string) => void;
  onSourceReady?: (sourceUrl: string) => void;
  onError?: (message: string) => void;
};

function isRemoteMediaApiPath(pathname: string): boolean {
  return (
    pathname === "/api/downloads" ||
    pathname.startsWith("/api/downloads/") ||
    pathname.startsWith("/api/shared-downloads/")
  );
}

function withAuthQuery(url: string): string {
  if (!url) return url;
  if (!url.startsWith("/api/")) return url;

  let pathname = "";
  try {
    pathname = new URL(url, "http://localhost").pathname;
  } catch {
    pathname = url.split("?")[0];
  }

  const standaloneToken = getActiveToken("local");
  const pairedToken = getRemoteServerToken();
  const serverUrl = safeStorageGet(localStorage, "nsv_server_url");
  const useRemoteMedia =
    Boolean(serverUrl && pairedToken) && isRemoteMediaApiPath(pathname);
  const token = useRemoteMedia ? pairedToken : standaloneToken;
  const deviceId = getDeviceId();
  const params: string[] = [];
  if (token) params.push(`t=${encodeURIComponent(token)}`);
  if (deviceId) params.push(`d=${encodeURIComponent(deviceId)}`);

  let finalUrl = url;
  if (useRemoteMedia && serverUrl) {
    finalUrl = `${serverUrl.replace(/\/$/, "")}${url}`;
  } else if (isTauriRuntime() && isMobileDevice()) {
    // Native AVPlayer relies on the local HTTP server, bypassing fetch IPC.
    finalUrl = `http://127.0.0.1:23400${url}`;
  }

  if (params.length === 0) return finalUrl;

  const sep = finalUrl.includes("?") ? "&" : "?";
  return `${finalUrl}${sep}${params.join("&")}`;
}

function withTransientQuery(url: string, key: string, value: string): string {
  if (!url) return url;
  try {
    const parsed = new URL(url, globalThis.location.origin);
    parsed.searchParams.set(key, value);
    return parsed.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

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
    className,
    textTracks = [],
    onTimeUpdate,
    onDurationChange,
    onPlayStateChange,
    onQualitySelection,
    onSourceReady,
    onError,
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
    const [resumeRevision, setResumeRevision] = useState(0);

    const useNativeResumeRefresh =
      isMobileDevice() && canPlayHlsNatively() && !canUseHlsJs();

    const src = useMemo(() => {
      let resolvedSrc = withAuthQuery(source.src);
      if (useNativeResumeRefresh && resumeRevision > 0) {
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
    }, [source.src, source.type, useNativeResumeRefresh, resumeRevision]);

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
      if (!onError) return;
      const isHls = (src.type || "").toLowerCase().includes("mpegurl");
      if (!isHls) return;

      if (!canUseHlsJs() && !canPlayHlsNatively()) {
        onError("This browser cannot play HLS streams on this device.");
      }
    }, [onError, src.type]);

    useEffect(() => {
      if (didSeekOnStartRef.current) return;
      if (!Number.isFinite(startTime) || (startTime || 0) <= 0) return;
      if (!store.canSeek || store.duration <= 0) return;

      didSeekOnStartRef.current = true;
      remote.seek(Math.max(0, startTime || 0));
    }, [startTime, store.canSeek, store.duration, remote]);

    useEffect(() => {
      if (!useNativeResumeRefresh) return;

      const triggerResumeRefresh = () => {
        const mediaState = storeRef.current;
        const currentTime = Number(mediaState.currentTime || 0);
        const canSeek =
          Boolean(mediaState.canSeek) && Number(mediaState.duration || 0) > 0;

        pendingResumeSeekRef.current =
          canSeek && Number.isFinite(currentTime)
            ? Math.max(0, currentTime)
            : null;
        pendingResumePlayRef.current = !mediaState.paused;
        setResumeRevision((prev) => prev + 1);
      };

      const onVisibilityChange = () => {
        if (document.visibilityState === "hidden") {
          wasBackgroundedRef.current = true;
          return;
        }

        if (wasBackgroundedRef.current) {
          wasBackgroundedRef.current = false;
          triggerResumeRefresh();
        }
      };

      const onPageHide = () => {
        wasBackgroundedRef.current = true;
      };

      const onPageShowOrFocus = () => {
        if (!wasBackgroundedRef.current) return;
        wasBackgroundedRef.current = false;
        triggerResumeRefresh();
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
    }, [useNativeResumeRefresh]);

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

      if (hlsInstanceRef.current) {
        try {
          hlsInstanceRef.current.stopLoad();
          hlsInstanceRef.current.detachMedia();
        } catch {
          // Ignore cleanup failures on stale instances.
        }
        hlsInstanceRef.current = null;
      }
    }, [src.src]);

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
          provider.library = Hls;
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
        textTracks.map((track) => (
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
