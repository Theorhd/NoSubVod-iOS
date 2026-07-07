import type Hls from "hls.js";
import { safeStorageGet } from "../../../../shared/utils/storage";
import {
  getActiveToken,
  getDeviceId,
  getRemoteServerToken,
} from "../../utils/authTokens";
import { isMobileDevice, isTauriRuntime } from "../../utils/capabilities";

export const BASE_STALL_RECOVERY_THRESHOLD_MS = 15_000;
export const NATIVE_HLS_STALL_RECOVERY_THRESHOLD_MS = 10_000;
export const NATIVE_VOD_SOURCE_REFRESH_INTERVAL_MS = 4 * 60 * 1000;
export const NATIVE_VOD_SOURCE_REFRESH_CHECK_MS = 20_000;

export function getHlsStabilityConfig(lockToFixedQuality: boolean) {
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

export function loadHlsLightLibrary() {
  return import("hls.js/dist/hls.light.js") as Promise<
    { default: typeof Hls } | undefined
  >;
}

export function hasFixedQualityPreference(
  defaultQuality: string | undefined,
): boolean {
  return Boolean(defaultQuality && defaultQuality !== "auto");
}

export function setHlsLevelMode(instance: Hls, level: number) {
  try {
    instance.currentLevel = level;
    instance.nextLevel = level;
    instance.loadLevel = level;
  } catch {
    // Ignore runtime constraints from stale/tearing down instances.
  }
}

export function normalizePlaylistText(raw: string): string {
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

export class InternalApiHlsLoader {
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

export function inferRequestedQualityValueFromEntry(entry: any): string | null {
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

  if (label.includes("audio")) {
    return "audio";
  }

  if (label.includes("source") || label.includes("chunked")) {
    return "source";
  }

  const height = Number((entry as { height?: number })?.height || 0);
  if (Number.isFinite(height) && height > 0) {
    return String(Math.round(height));
  }

  const maybeDigits = label
    .split(/\D+/)
    .find((chunk) => chunk && chunk.length > 0);

  return maybeDigits || null;
}

export function sortedQualitiesByHeightDesc(qualities: any[]): QualityEntry[] {
  return qualities
    .map((q, idx) => ({
      idx,
      height: Number((q as { height?: number }).height || 0),
      isAudio: String(
        (q as { id?: string; label?: string })?.id ||
          (q as { label?: string })?.label ||
          "",
      )
        .toLowerCase()
        .includes("audio"),
    }))
    .filter((q) => q.height > 0 || q.isAudio)
    .sort((a, b) => b.height - a.height);
}

export function resolveRequestedQuality(
  sorted: QualityEntry[],
  defaultQuality: string | undefined,
): number {
  if (sorted.length === 0) {
    return -1;
  }

  const normalizedQuality = (defaultQuality || "").trim().toLowerCase();
  if (!normalizedQuality || normalizedQuality === "auto") {
    return -1;
  }

  if (normalizedQuality === "source" || normalizedQuality === "chunked") {
    return sorted[0]?.idx ?? -1;
  }

  if (normalizedQuality === "audio") {
    const audioIdx = sorted.findIndex((q: any) => q.isAudio || q.height === 0);
    return audioIdx >= 0 ? sorted[audioIdx].idx : -1;
  }

  const requestedHeightNum = Number(normalizedQuality);
  if (!Number.isNaN(requestedHeightNum)) {
    const exact = sorted.find(
      (quality) => quality.height === requestedHeightNum,
    );
    if (exact) return exact.idx;

    const closest = sorted.find(
      (quality) => quality.height < requestedHeightNum,
    );
    if (closest) return closest.idx;
  }

  return sorted[sorted.length - 1]?.idx ?? -1;
}

function isRemoteMediaApiPath(pathname: string): boolean {
  return (
    pathname === "/api/downloads" ||
    pathname.startsWith("/api/downloads/") ||
    pathname.startsWith("/api/shared-downloads/")
  );
}

export function withAuthQuery(url: string): string {
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

export function withTransientQuery(
  url: string,
  key: string,
  value: string,
): string {
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
