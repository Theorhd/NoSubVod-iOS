import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type NormalizedQuality = "auto" | "480" | "720" | "1080" | "source";

function normalizeQualitySetting(raw: string | undefined): NormalizedQuality {
  const normalized = (raw || "auto").trim().toLowerCase();
  if (normalized === "source" || normalized === "chunked") {
    return "source";
  }

  if (normalized === "480" || normalized === "720" || normalized === "1080") {
    return normalized;
  }

  return "auto";
}

function normalizeRequestedQualityValue(
  raw: string | undefined,
): string | null {
  if (!raw) return null;

  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "auto") return "auto";

  if (
    normalized === "source" ||
    normalized === "chunked" ||
    normalized.includes("source") ||
    normalized.includes("chunked")
  ) {
    return "source";
  }

  const maybeDigits = normalized
    .split(/\D+/)
    .find((chunk) => chunk && chunk.length > 0);
  if (!maybeDigits) return null;

  const height = Number.parseInt(maybeDigits, 10);
  if (!Number.isFinite(height) || height <= 0) return null;

  return String(height);
}

function buildQualityQuery(
  quality: string | undefined,
  mode?: "lock" | "strict",
): string {
  const normalizedQuality = normalizeRequestedQualityValue(quality);
  if (!normalizedQuality || normalizedQuality === "auto") {
    return "";
  }

  const params = new URLSearchParams();
  params.set("quality", normalizedQuality);
  if (mode) {
    params.set("qualityMode", mode);
  }

  return `?${params.toString()}`;
}

import { VOD } from "../../../shared/types";

export function useVideoQuality(
  vodId: string | null,
  liveId: string | null,
  vodInfo: VOD | null,
  defaultVideoQuality: string | undefined,
  historySyncLastObservedTime: number,
  currentTime: number,
) {
  const [vodQualityStage, setVodQualityStage] = useState<
    "auto" | "bootstrap" | "preferred"
  >("auto");
  const [manualLockedQuality, setManualLockedQuality] = useState<string | null>(
    null,
  );

  const pendingQualityResumeTimeRef = useRef<number | null>(null);

  const normalizedDefaultQuality = useMemo(() => {
    return normalizeQualitySetting(defaultVideoQuality);
  }, [defaultVideoQuality]);

  const normalizedManualLockedQuality = useMemo(() => {
    return normalizeRequestedQualityValue(manualLockedQuality || undefined);
  }, [manualLockedQuality]);

  useEffect(() => {
    if (!vodId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVodQualityStage("auto");
      return;
    }

    if (normalizedDefaultQuality === "auto") {
      setVodQualityStage("auto");
      return;
    }

    if (normalizedDefaultQuality === "480") {
      setVodQualityStage("preferred");
      return;
    }

    setVodQualityStage("bootstrap");
  }, [normalizedDefaultQuality, vodId]);

  const handlePlayerSourceReady = useCallback(
    (sourceUrl: string, setSeekTo: (time: number) => void) => {
      if (!vodId) return;

      const pendingResumeTime = pendingQualityResumeTimeRef.current;
      if (pendingResumeTime !== null) {
        pendingQualityResumeTimeRef.current = null;
        setSeekTo(Math.max(0, pendingResumeTime));
      }

      if (vodQualityStage !== "bootstrap") return;

      const expectedBootstrapSource = `/api/vod/${vodId}/master.m3u8?quality=480`;
      if (sourceUrl !== expectedBootstrapSource) return;

      setVodQualityStage("preferred");
    },
    [vodId, vodQualityStage],
  );

  const handlePlayerQualitySelection = useCallback(
    (requestedQuality: string) => {
      if (!vodId) return;

      const normalizedRequested =
        normalizeRequestedQualityValue(requestedQuality);
      if (!normalizedRequested || normalizedRequested === "auto") {
        return;
      }

      const hasPreferredBaseLock =
        vodQualityStage === "preferred" && normalizedDefaultQuality !== "auto";
      let activeLockedQuality: string | null = null;
      if (manualLockedQuality) {
        activeLockedQuality =
          normalizeRequestedQualityValue(manualLockedQuality);
      } else if (hasPreferredBaseLock) {
        activeLockedQuality = normalizedDefaultQuality;
      }

      if (activeLockedQuality === normalizedRequested) {
        pendingQualityResumeTimeRef.current = null;
        return;
      }

      const resumeTime = Math.max(
        0,
        Number(historySyncLastObservedTime || currentTime || 0),
      );
      pendingQualityResumeTimeRef.current = resumeTime;

      setVodQualityStage("preferred");
      setManualLockedQuality(normalizedRequested);
    },
    [
      manualLockedQuality,
      normalizedDefaultQuality,
      vodId,
      vodQualityStage,
      historySyncLastObservedTime,
      currentTime,
    ],
  );

  const source = useMemo(() => {
    if (vodId) {
      if (vodInfo?.broadcastType === "clip" && vodInfo?.previewThumbnailURL) {
        // Twitch clip thumbnails follow the pattern:
        //   https://clips-media-assets2.twitch.tv/AT-cm%7C...-preview-480x272.jpg
        // We derive the MP4 URL by stripping the "-preview-{w}x{h}.jpg" suffix.
        const thumbnailUrl = vodInfo.previewThumbnailURL;
        const mp4Url = thumbnailUrl.replace(/-preview-.*\.jpg$/, ".mp4");

        if (mp4Url === thumbnailUrl) {
          // The regex matched nothing — Twitch may have changed their CDN URL format.
          console.warn(
            "[useVideoQuality] Unexpected clip thumbnail URL format — cannot derive MP4 URL:",
            thumbnailUrl,
          );
          return null;
        }

        return {
          src: mp4Url,
          type: "video/mp4",
          streamType: "on-demand" as const,
        };
      }

      const normalizedManualLock = normalizedManualLockedQuality;

      if (normalizedManualLock && normalizedManualLock !== "auto") {
        return {
          src: `/api/vod/${vodId}/master.m3u8${buildQualityQuery(normalizedManualLock, "lock")}`,
          type: "application/x-mpegurl",
          streamType: "on-demand" as const,
        };
      }

      // NOTE: We intentionally removed `shouldBoostVodQualityForFullscreen` here.
      // Forcing a stream reload when entering full screen causes severe stability issues.
      // HLS.js adaptive bitrate will handle quality scaling automatically based on player size if quality is "auto".

      let vodQuality: NormalizedQuality = normalizedDefaultQuality;
      if (vodQualityStage === "bootstrap") {
        vodQuality = "480";
      }

      const qualityMode =
        vodQualityStage === "preferred" && vodQuality !== "auto"
          ? "lock"
          : undefined;

      return {
        src: `/api/vod/${vodId}/master.m3u8${buildQualityQuery(vodQuality, qualityMode)}`,
        type: "application/x-mpegurl",
        streamType: "on-demand" as const,
      };
    }

    if (liveId) {
      let liveQuality: NormalizedQuality = normalizedDefaultQuality;
      if (vodQualityStage === "bootstrap") {
        liveQuality = "480";
      }

      const normalizedManualLock = normalizedManualLockedQuality;
      const qualityMode =
        (vodQualityStage === "preferred" && liveQuality !== "auto") ||
        normalizedManualLock
          ? "lock"
          : undefined;

      const activeQuality =
        normalizedManualLock && normalizedManualLock !== "auto"
          ? normalizedManualLock
          : liveQuality;

      return {
        src: `/api/live/${encodeURIComponent(liveId)}/master.m3u8${buildQualityQuery(activeQuality, qualityMode)}`,
        type: "application/x-mpegurl",
        streamType: "live" as const,
      };
    }

    return null;
  }, [
    liveId,
    normalizedManualLockedQuality,
    normalizedDefaultQuality,
    vodId,
    vodQualityStage,
    vodInfo,
  ]);

  const resetQualityState = useCallback(() => {
    setManualLockedQuality(null);
    setVodQualityStage("auto");
    pendingQualityResumeTimeRef.current = null;
  }, []);

  return {
    source,
    normalizedDefaultQuality,
    handlePlayerSourceReady,
    handlePlayerQualitySelection,
    resetQualityState,
  };
}
