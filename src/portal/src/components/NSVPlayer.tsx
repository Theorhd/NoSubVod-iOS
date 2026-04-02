import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { MediaPlayer, MediaProvider, useMediaRemote, useMediaStore } from '@vidstack/react';
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default';
import Hls from 'hls.js/dist/hls.light.js';
import { safeStorageGet } from '../../../shared/utils/storage';
import { canPlayHlsNatively, canUseHlsJs, isMobileDevice } from '../utils/capabilities';

function getHlsStabilityConfig() {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    startLevel: -1,
    capLevelToPlayerSize: true,
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

function isTauriRuntime(): boolean {
  return Boolean((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
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
      headers.set('Range', `bytes=${context.rangeStart}-${context.rangeEnd}`);
    }

    fetch(context.url, {
      method: 'GET',
      headers,
      signal: this.abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok && response.status !== 206) {
          callbacks.onError(
            { code: response.status, text: `HLS load failed (${response.status})` },
            context,
            null,
            undefined
          );
          return;
        }

        const loadedAt = performance.now();
        const stats = {
          aborted: false,
          loaded: 0,
          retry: 0,
          total: Number(response.headers.get('content-length') || 0),
          chunkCount: 1,
          bwEstimate: 0,
          trequest: startedAt,
          tfirst: loadedAt,
          tload: loadedAt,
        };

        const isBinary = context.responseType === 'arraybuffer';
        if (isBinary) {
          const data = await response.arrayBuffer();
          stats.loaded = data.byteLength;
          stats.total = stats.total || data.byteLength;
          stats.tload = performance.now();
          callbacks.onSuccess({ url: context.url, data }, stats, context, response);
          return;
        }

        const data = await response.text();
        stats.loaded = data.length;
        stats.total = stats.total || data.length;
        stats.tload = performance.now();
        callbacks.onSuccess({ url: context.url, data }, stats, context, response);
      })
      .catch((error) => {
        if (this.abortController?.signal.aborted) {
          return;
        }
        callbacks.onError(
          { code: 0, text: error instanceof Error ? error.message : String(error) },
          context,
          error,
          undefined
        );
      });
  }
}

type QualityEntry = {
  idx: number;
  height: number;
};

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
  defaultQuality: string | undefined
): number {
  if (sorted.length === 0) {
    return -1;
  }

  if (!defaultQuality || defaultQuality === 'auto') {
    return -1;
  }

  const requestedHeight = Number.parseInt(defaultQuality, 10);
  if (Number.isNaN(requestedHeight)) {
    return -1;
  }

  const exact = sorted.find((quality) => quality.height === requestedHeight);
  if (exact) return exact.idx;

  const closestBelow = sorted.find((quality) => quality.height < requestedHeight);
  if (closestBelow) return closestBelow.idx;

  return sorted[sorted.length - 1]?.idx ?? -1;
}

export type NSVMediaSource = {
  src: string;
  type?: string;
};

export type NSVTextTrack = {
  src: string;
  kind: 'subtitles' | 'captions' | 'chapters' | 'descriptions' | 'metadata';
  label: string;
  language: string;
  default?: boolean;
};

type NSVPlayerProps = {
  source: NSVMediaSource;
  title: string;
  poster?: string;
  streamType?: 'on-demand' | 'live' | 'll-live';
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
  onError?: (message: string) => void;
};

function withAuthQuery(url: string): string {
  if (!url) return url;
  if (!url.startsWith('/api/')) return url;

  const token = safeStorageGet(sessionStorage, 'nsv_token');
  const deviceId = safeStorageGet(localStorage, 'nsv_device_id');
  const params: string[] = [];
  if (token) params.push(`t=${encodeURIComponent(token)}`);
  if (deviceId) params.push(`d=${encodeURIComponent(deviceId)}`);
  if (params.length === 0) return url;

  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${params.join('&')}`;
}

const NSVPlayer = React.memo(
  ({
    source,
    title,
    poster,
    streamType = 'on-demand',
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

    const src = useMemo(
      () => ({
        src: withAuthQuery(source.src),
        type: source.type,
      }),
      [source.src, source.type]
    );

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
      onError(store.error.message || 'Playback failed.');
    }, [store.error, onError]);

    useEffect(() => {
      if (!onError) return;
      const isHls = (src.type || '').toLowerCase().includes('mpegurl');
      if (!isHls) return;

      if (!canUseHlsJs() && !canPlayHlsNatively()) {
        onError('This browser cannot play HLS streams on this device.');
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
      didSeekOnStartRef.current = false;
      lastExternalSeekRef.current = null;
      didApplyDefaultQualityRef.current = false;

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
      if (streamType !== 'on-demand') {
        didApplyDefaultQualityRef.current = true;
        return;
      }

      try {
        const sorted = sortedQualitiesByHeightDesc(store.qualities as any[]);
        const qualityIdx = resolveRequestedQuality(sorted, defaultQuality);

        if (qualityIdx < 0) {
          didApplyDefaultQualityRef.current = true;
          return;
        }

        remote.changeQuality(qualityIdx);
        didApplyDefaultQualityRef.current = true;
      } catch (error) {
        didApplyDefaultQualityRef.current = false;
        console.error('[NSVPlayer] Failed to apply default quality', error);
      }
    }, [defaultQuality, remote, store.canSetQuality, store.qualities, streamType]);

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
        case 'play':
          r.play();
          break;
        case 'pause':
          r.pause();
          break;
        case 'seek':
          r.seek(Math.max(0, Math.min(s.duration, (s.currentTime || 0) + val)));
          break;
        case 'volume':
          r.changeVolume(val);
          break;
        case 'mute':
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
        remoteRef.current.seek(Math.max(0, Math.min(s.duration, (s.currentTime || 0) + val)));
      };
      const onVolume = (e: any) => remoteRef.current.changeVolume(e.detail?.value ?? 1);
      const onMute = () => remoteRef.current.toggleMuted();

      globalThis.addEventListener('nsv-remote-play', onPlay);
      globalThis.addEventListener('nsv-remote-pause', onPause);
      globalThis.addEventListener('nsv-remote-seek', onSeek);
      globalThis.addEventListener('nsv-remote-volume', onVolume);
      globalThis.addEventListener('nsv-remote-mute', onMute);

      let unlisten: (() => void) | undefined;
      const isTauri = (globalThis as any).__TAURI_INTERNALS__ || (globalThis as any).__TAURI__;

      if (isTauri) {
        const setupTauriListener = async () => {
          try {
            const { listen } = await import('@tauri-apps/api/event');
            unlisten = await listen('nsv-control', handleRemoteControl);
          } catch (err) {
            console.error('[NSVPlayer] Failed to load Tauri event API:', err);
          }
        };
        void setupTauriListener();
      }

      return () => {
        globalThis.removeEventListener('nsv-remote-play', onPlay);
        globalThis.removeEventListener('nsv-remote-pause', onPause);
        globalThis.removeEventListener('nsv-remote-seek', onSeek);
        globalThis.removeEventListener('nsv-remote-volume', onVolume);
        globalThis.removeEventListener('nsv-remote-mute', onMute);
        if (unlisten) unlisten();
      };
    }, [handleRemoteControl]);

    const onProviderChange = useCallback((provider: any) => {
      if (provider?.type === 'hls') {
        if (!canUseHlsJs()) return;
        provider.library = Hls;
        const hlsConfig = getHlsStabilityConfig();
        const loaderConfig = isTauriRuntime() ? { loader: InternalApiHlsLoader } : {};
        provider.config = provider.config
          ? { ...provider.config, ...hlsConfig, ...loaderConfig }
          : { ...hlsConfig, ...loaderConfig };
      }
    }, []);

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
      [textTracks]
    );

    return (
      <MediaPlayer
        onProviderChange={onProviderChange}
        onHlsInstance={handleHlsInstance}
        ref={playerRef}
        className={className}
        title={title}
        src={src as any}
        viewType="video"
        poster={poster}
        streamType={streamType}
        load={streamType === 'on-demand' ? 'eager' : 'visible'}
        preload="metadata"
        autoPlay={autoPlay}
        muted={effectiveMuted}
        playsInline
        keyTarget="player"
        keyShortcuts={{
          togglePaused: 'k Space',
          toggleMuted: 'm',
          toggleFullscreen: 'f',
          togglePictureInPicture: 'i',
          toggleCaptions: 'c',
          seekBackward: 'ArrowLeft',
          seekForward: 'ArrowRight',
          volumeUp: 'ArrowUp',
          volumeDown: 'ArrowDown',
        }}
        aspectRatio="16/9"
        crossOrigin="anonymous"
      >
        <MediaProvider>{renderedTextTracks}</MediaProvider>
        <DefaultVideoLayout icons={defaultLayoutIcons} />
      </MediaPlayer>
    );
  }
);

NSVPlayer.displayName = 'NSVPlayer';
export default NSVPlayer;
