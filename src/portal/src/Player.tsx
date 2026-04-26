import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Search, X } from "lucide-react";
import {
  ChatMessage,
  ExperienceSettings,
  LiveStream,
  VideoMarker,
  VOD,
} from "../../shared/types";
import NSVPlayer from "./components/NSVPlayer";
import LiveChatComponent from "./components/player/LiveChatComponent";
import MarkerPanel from "./components/player/MarkerPanel";
import ClipMode from "./components/player/ClipMode";
import PlayerInfo from "./components/player/PlayerInfo";
import { formatSafeClock as formatClock } from "../../shared/utils/formatters";
import PlayerRTC from "./PlayerRTC";
import { useResponsive } from "./hooks/useResponsive";
import { normalizeExperienceSettings } from "./utils/experienceSettings";
import { navigateBackInApp } from "./utils/navigation";
import { buildAuthSuffix } from "./utils/authTokens";
import { useInterval } from "../../shared/hooks/useInterval";
import "./styles/Player.css";

const DEFAULT_SETTINGS: ExperienceSettings = {
  oneSync: false,
  defaultVideoQuality: "auto",
};

const CHAT_REPLAY_VISIBLE_MESSAGES = 170;
const CHAT_REPLAY_FUTURE_TOLERANCE_SECONDS = 0.35;
const CHAT_REPLAY_SEEK_RESET_SECONDS = 2;
const MAX_CHAT_MESSAGES = 700;
const CHAT_HISTORY_SECONDS = 10 * 60;
const HISTORY_SYNC_INTERVAL_MS = 6000;
const HISTORY_MIN_SAVE_DELTA_SECONDS = 3;
const HISTORY_SEEK_SAVE_DELTA_SECONDS = 20;
const HISTORY_ACTIVE_WINDOW_MS = 12000;

type PlayerRouteState = {
  from?: string;
};

type SaveProgressOptions = {
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

function resolvePlayerTitle(
  vodId: string | null,
  liveId: string | null,
): string {
  if (vodId) return `VOD: ${vodId}`;
  if (liveId) return `Live: ${liveId}`;
  return "Player";
}

function parseMarkersPayload(payload: unknown): VideoMarker[] {
  if (Array.isArray(payload)) {
    return payload as VideoMarker[];
  }

  if (payload && typeof payload === "object") {
    const maybeMarkers = (payload as { markers?: unknown }).markers;
    if (Array.isArray(maybeMarkers)) {
      return maybeMarkers as VideoMarker[];
    }
  }

  return [];
}

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

function normalizeArtworkUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;

  const normalized = rawUrl
    .replaceAll("%{width}", "1280")
    .replaceAll("%{height}", "720")
    .replaceAll("{width}", "1280")
    .replaceAll("{height}", "720")
    .trim();

  return normalized || null;
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

function extractChatMessageText(message: ChatMessage): string {
  const messagePayload = message.message as
    | {
        fragments?: Array<{ text?: string | null } | null> | null;
        text?: string;
        body?: string;
      }
    | undefined;

  if (Array.isArray(messagePayload?.fragments)) {
    return messagePayload.fragments
      .map((fragment) =>
        typeof fragment?.text === "string" ? fragment.text : "",
      )
      .join("");
  }

  if (typeof messagePayload?.text === "string") {
    return messagePayload.text;
  }

  if (typeof messagePayload?.body === "string") {
    return messagePayload.body;
  }

  return "";
}

const ChatSearch = ({
  vodId,
  onSeek,
  onClose,
}: {
  vodId: string;
  onSeek: (time: number) => void;
  onClose: () => void;
}) => {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/vod/${vodId}/chat?keyword=${encodeURIComponent(keyword)}`,
      );
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="chat-search-overlay">
      <div className="chat-search-header">
        <div className="chat-search-input-wrapper">
          <input
            autoFocus
            type="text"
            className="search-input chat-search-input"
            placeholder="Rechercher dans le chat..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <Search size={18} className="chat-search-icon" />
        </div>
        <button
          className="secondary-btn chat-search-close-btn"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="chat-search-results">
        {results.length === 0 && !searching && keyword && (
          <div className="chat-search-no-results">
            Aucun résultat trouvé pour &quot;{keyword}&quot;
          </div>
        )}
        {results.map((res: any) => (
          <button
            key={res.id}
            onClick={() => onSeek(res.contentOffsetSeconds)}
            className="chat-search-result-item hover-card"
          >
            <div className="chat-search-result-header">
              <span className="chat-search-result-name">
                {res.commenter?.displayName}
              </span>
              <span className="chat-search-result-time">
                {formatClock(res.contentOffsetSeconds)}
              </span>
            </div>
            <div className="chat-search-result-message">{res.message}</div>
          </button>
        ))}
        {searching && <div className="chat-search-loading">Recherche en cours...</div>}
      </div>
    </div>
  );
};

export default function Player() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const vodId = searchParams.get("vod");
  const liveId = searchParams.get("live");
  const downloadMode = searchParams.get("downloadMode") === "true";
  const screenShareParam =
    searchParams.get("screenshare") ?? searchParams.get("screenShare");
  const screenShareMode =
    screenShareParam === "true" || screenShareParam === "1";
  const routeState = location.state as PlayerRouteState | null;
  const returnPath =
    typeof routeState?.from === "string" ? routeState.from : null;

  if (screenShareMode) {
    return <PlayerRTC />;
  }

  return (
    <VodLivePlayer
      vodId={vodId}
      liveId={liveId}
      downloadMode={downloadMode}
      returnPath={returnPath}
    />
  );
}

type VodLivePlayerProps = {
  readonly vodId: string | null;
  readonly liveId: string | null;
  readonly downloadMode: boolean;
  readonly returnPath: string | null;
};

function VodLivePlayer({
  vodId,
  liveId,
  downloadMode,
  returnPath,
}: VodLivePlayerProps) {
  const { isMobileLayout, isLandscape } = useResponsive();
  const navigate = useNavigate();
  const mediaKey = useMemo(() => {
    if (vodId) return `vod:${vodId}`;
    if (liveId) return `live:${liveId}`;
    return "none";
  }, [vodId, liveId]);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastChatOffsetRef = useRef(-1);
  const pendingChatOffsetsRef = useRef(new Set<number>());
  const previousMediaKeyRef = useRef<string>(mediaKey);
  const lastRenderedSecondRef = useRef(-1);
  const lastRequestedOffsetRef = useRef(-1);
  const markersLoadedVodRef = useRef<string | null>(null);
  const markersLoadingRef = useRef(false);

  const [showChat, setShowChat] = useState(false);
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [showMarkers, setShowMarkers] = useState(false);
  const [markers, setMarkers] = useState<VideoMarker[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [vodInfo, setVodInfo] = useState<VOD | null>(null);
  const [liveInfo, setLiveInfo] = useState<LiveStream | null>(null);
  const [initialTime, setInitialTime] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [manualLockedQuality, setManualLockedQuality] = useState<string | null>(
    null,
  );

  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const pendingQualityResumeTimeRef = useRef<number | null>(null);
  const previousFullscreenBoostStateRef = useRef(false);
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
  const saveProgressRef = useRef<(options?: SaveProgressOptions) => void>(
    () => {
      // Initialized later via effect.
    },
  );

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

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
    [queueHistoryPayload],
  );

  useEffect(() => {
    saveProgressRef.current = saveProgress;
  }, [saveProgress]);

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
  }, []);

  const [clipStart, setClipStart] = useState<number | null>(null);
  const [clipEnd, setClipEnd] = useState<number | null>(null);
  const [settings, setSettings] =
    useState<ExperienceSettings>(DEFAULT_SETTINGS);
  const [vodQualityStage, setVodQualityStage] = useState<
    "auto" | "bootstrap" | "preferred"
  >("auto");

  const normalizedDefaultQuality = useMemo(() => {
    return normalizeQualitySetting(settings.defaultVideoQuality);
  }, [settings.defaultVideoQuality]);

  const normalizedManualLockedQuality = useMemo(() => {
    return normalizeRequestedQualityValue(manualLockedQuality || undefined);
  }, [manualLockedQuality]);

  const shouldBoostVodQualityForFullscreen = useMemo(() => {
    if (!vodId || !isFullscreen) {
      return false;
    }

    if (normalizedDefaultQuality !== "auto") {
      return false;
    }

    if (
      normalizedManualLockedQuality &&
      normalizedManualLockedQuality !== "auto"
    ) {
      return false;
    }

    return true;
  }, [
    isFullscreen,
    normalizedDefaultQuality,
    normalizedManualLockedQuality,
    vodId,
  ]);

  useEffect(() => {
    if (!vodId) {
      previousFullscreenBoostStateRef.current =
        shouldBoostVodQualityForFullscreen;
      return;
    }

    const previous = previousFullscreenBoostStateRef.current;
    if (previous === shouldBoostVodQualityForFullscreen) {
      return;
    }

    previousFullscreenBoostStateRef.current =
      shouldBoostVodQualityForFullscreen;
    pendingQualityResumeTimeRef.current = Math.max(
      0,
      Number(
        historySyncRef.current.lastObservedTime || currentTimeRef.current || 0,
      ),
    );
  }, [shouldBoostVodQualityForFullscreen, vodId]);

  useEffect(() => {
    if (!vodId) {
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
    (sourceUrl: string) => {
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
        Number(
          historySyncRef.current.lastObservedTime ||
            currentTimeRef.current ||
            0,
        ),
      );
      pendingQualityResumeTimeRef.current = resumeTime;

      setVodQualityStage("preferred");
      setManualLockedQuality(normalizedRequested);
    },
    [manualLockedQuality, normalizedDefaultQuality, vodId, vodQualityStage],
  );

  const playerTitle = useMemo(
    () => resolvePlayerTitle(vodId, liveId),
    [vodId, liveId],
  );

  const source = useMemo(() => {
    if (vodId) {
      const normalizedManualLock = normalizedManualLockedQuality;

      if (normalizedManualLock && normalizedManualLock !== "auto") {
        return {
          src: `/api/vod/${vodId}/master.m3u8${buildQualityQuery(normalizedManualLock, "lock")}`,
          type: "application/x-mpegurl",
          streamType: "on-demand" as const,
        };
      }

      if (shouldBoostVodQualityForFullscreen) {
        return {
          src: `/api/vod/${vodId}/master.m3u8${buildQualityQuery("source", "lock")}`,
          type: "application/x-mpegurl",
          streamType: "on-demand" as const,
        };
      }

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
      return {
        src: `/api/live/${encodeURIComponent(liveId)}/master.m3u8`,
        type: "application/x-mpegurl",
        streamType: "live" as const,
      };
    }

    return null;
  }, [
    liveId,
    normalizedManualLockedQuality,
    normalizedDefaultQuality,
    shouldBoostVodQualityForFullscreen,
    vodId,
    vodQualityStage,
  ]);

  const playerMediaSource = useMemo(
    () => (source ? { src: source.src, type: source.type } : null),
    [source],
  );

  const playerPoster = useMemo(() => {
    if (vodId) {
      return (
        normalizeArtworkUrl(vodInfo?.previewThumbnailURL) ||
        normalizeArtworkUrl(vodInfo?.owner?.profileImageURL) ||
        undefined
      );
    }

    if (liveId) {
      return (
        normalizeArtworkUrl(liveInfo?.previewImageURL) ||
        normalizeArtworkUrl(liveInfo?.broadcaster?.profileImageURL) ||
        undefined
      );
    }

    return undefined;
  }, [liveId, liveInfo, vodId, vodInfo]);

  const shouldLoadChat = Boolean(vodId && showChat && !isFullscreen);
  const shouldUpdateUiTime = showMarkers || shouldLoadChat || downloadMode;

  const replayChatMessages = useMemo(() => {
    if (!shouldLoadChat) return [];
    if (chatMessages.length === 0) return [];

    const firstFutureIndex = chatMessages.findIndex(
      (m) =>
        m.contentOffsetSeconds >
        currentTime + CHAT_REPLAY_FUTURE_TOLERANCE_SECONDS,
    );
    const replayEndIndex =
      firstFutureIndex === -1 ? chatMessages.length : firstFutureIndex;
    const replayStartIndex = Math.max(
      0,
      replayEndIndex - CHAT_REPLAY_VISIBLE_MESSAGES,
    );

    return chatMessages.slice(replayStartIndex, replayEndIndex);
  }, [chatMessages, currentTime, shouldLoadChat]);

  const dispatchedChatIds = useRef(new Set<string>());
  useEffect(() => {
    if (liveId || !shouldLoadChat) return;
    for (const msg of replayChatMessages) {
      if (!dispatchedChatIds.current.has(msg.id)) {
        dispatchedChatIds.current.add(msg.id);
        globalThis.dispatchEvent(
          new CustomEvent("nsv-chat-message", { detail: msg }),
        );
      }
    }
    // Bound memory without clearing everything (which would cause redispatch storms).
    const MAX_DISPATCHED_IDS = 2500;
    const TRIM_TO = 1800;
    if (dispatchedChatIds.current.size > MAX_DISPATCHED_IDS) {
      const toDrop = dispatchedChatIds.current.size - TRIM_TO;
      let dropped = 0;
      for (const id of dispatchedChatIds.current) {
        dispatchedChatIds.current.delete(id);
        dropped += 1;
        if (dropped >= toDrop) break;
      }
    }
  }, [replayChatMessages, liveId, shouldLoadChat]);

  const fetchVodChatChunk = useCallback(
    async (offset: number) => {
      if (!vodId) return;
      if (offset === lastChatOffsetRef.current) return;
      if (pendingChatOffsetsRef.current.has(offset)) return;

      pendingChatOffsetsRef.current.add(offset);

      try {
        const res = await fetch(
          `/api/vod/${vodId}/chat?offset=${offset}&limit=100`,
        );
        if (!res.ok) return;

        const data = await res.json();
        setChatMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const incoming = (data.messages || []).filter(
            (m: ChatMessage) => !known.has(m.id),
          );
          if (incoming.length === 0) return prev;

          const merged = [...prev, ...incoming].sort(
            (a, b) => a.contentOffsetSeconds - b.contentOffsetSeconds,
          );

          // Keep a bounded chat window to avoid unbounded memory growth on long VOD sessions.
          const now = currentTimeRef.current || 0;
          const cutoff = Math.max(0, now - CHAT_HISTORY_SECONDS);
          const recent = merged.filter(
            (message) => message.contentOffsetSeconds >= cutoff,
          );

          if (recent.length <= MAX_CHAT_MESSAGES) return recent;
          return recent.slice(recent.length - MAX_CHAT_MESSAGES);
        });

        lastChatOffsetRef.current = offset;
      } catch (error) {
        console.error("Failed to fetch chat", error);
      } finally {
        pendingChatOffsetsRef.current.delete(offset);
      }
    },
    [vodId],
  );

  const handlePlayerTimeUpdate = useCallback(
    (time: number) => {
      const previousTime = currentTimeRef.current;
      currentTimeRef.current = time;

      if (
        shouldLoadChat &&
        Math.abs(time - previousTime) >= CHAT_REPLAY_SEEK_RESET_SECONDS
      ) {
        dispatchedChatIds.current.clear();
      }

      if (vodId) {
        const syncState = historySyncRef.current;
        const previousObserved = syncState.lastObservedTime;
        syncState.lastObservedTime = time;
        syncState.lastTickAtMs = Date.now();

        if (
          previousObserved > 0 &&
          Math.abs(time - previousObserved) >= HISTORY_SEEK_SAVE_DELTA_SECONDS
        ) {
          saveProgressRef.current({
            force: true,
            timecode: time,
          });
        }
      }

      const roundedSecond = Math.floor(time);
      if (
        shouldUpdateUiTime &&
        roundedSecond !== lastRenderedSecondRef.current
      ) {
        lastRenderedSecondRef.current = roundedSecond;
        setCurrentTime(time);
      }

      if (!shouldLoadChat) return;
      const offset = Math.floor(time / 60) * 60;
      if (offset === lastRequestedOffsetRef.current) return;
      lastRequestedOffsetRef.current = offset;
      void fetchVodChatChunk(offset);
    },
    [fetchVodChatChunk, shouldLoadChat, shouldUpdateUiTime, vodId],
  );

  useEffect(() => {
    if (shouldLoadChat) {
      lastRequestedOffsetRef.current = -1;
      lastChatOffsetRef.current = -1;
      const offset = Math.floor((currentTimeRef.current || 0) / 60) * 60;
      void fetchVodChatChunk(offset);
      return;
    }

    pendingChatOffsetsRef.current.clear();
    dispatchedChatIds.current.clear();
    setChatMessages((prev) => {
      if (prev.length <= 120) return prev;
      return prev.slice(prev.length - 120);
    });
  }, [fetchVodChatChunk, shouldLoadChat]);

  useEffect(() => {
    if (!shouldLoadChat) return;
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [replayChatMessages, shouldLoadChat]);

  useEffect(() => {
    const onFullScreenChanged = () =>
      setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullScreenChanged);
    return () =>
      document.removeEventListener("fullscreenchange", onFullScreenChanged);
  }, []);

  useEffect(() => {
    if (previousMediaKeyRef.current === mediaKey) return;
    previousMediaKeyRef.current = mediaKey;

    setPlayerError(null);
    setChatMessages([]);
    setMarkers([]);
    setVodInfo(null);
    setLiveInfo(null);
    setCurrentTime(0);
    setDuration(0);
    setInitialTime(0);
    setSeekTo(null);
    setClipStart(null);
    setClipEnd(null);
    setManualLockedQuality(null);
    setVodQualityStage("auto");
    lastChatOffsetRef.current = -1;
    lastRenderedSecondRef.current = -1;
    lastRequestedOffsetRef.current = -1;
    markersLoadedVodRef.current = null;
    markersLoadingRef.current = false;
    pendingQualityResumeTimeRef.current = null;
    pendingChatOffsetsRef.current.clear();
    dispatchedChatIds.current.clear();
    historySyncRef.current = {
      inFlight: false,
      queued: null,
      lastSavedTime: 0,
      lastSentAtMs: 0,
      lastObservedTime: 0,
      lastTickAtMs: 0,
    };
  }, [mediaKey]);

  useEffect(() => {
    let disposed = false;

    const run = async () => {
      if (!vodId) return;

      try {
        const authSuffix = buildAuthSuffix("local");

        const [historyRes, infoRes, settingsRes] = await Promise.all([
          fetch(`/api/history/${vodId}${authSuffix}`),
          fetch(`/api/vod/${vodId}/info${authSuffix}`),
          fetch(`/api/settings${authSuffix}`),
        ]);

        if (!disposed && historyRes.ok) {
          const hist = await historyRes.json();
          const savedTime = Math.max(0, Number(hist?.timecode || 0));
          const resumeTime = Math.max(0, savedTime - 5);
          setInitialTime(resumeTime);

          const syncState = historySyncRef.current;
          syncState.lastSavedTime = savedTime;
          syncState.lastObservedTime = savedTime;
          syncState.lastTickAtMs = Date.now();
        }

        if (!disposed && infoRes.ok) {
          setVodInfo(await infoRes.json());
        }

        if (!disposed) {
          if (settingsRes.ok) {
            try {
              const remoteSettings =
                (await settingsRes.json()) as ExperienceSettings;
              setSettings((prev) => ({
                ...prev,
                ...normalizeExperienceSettings(remoteSettings),
              }));
            } catch (error) {
              console.error(
                "[Player] Failed to parse VOD settings payload",
                error,
              );
            }
          } else {
            console.warn("[Player] VOD settings request failed", {
              status: settingsRes.status,
              statusText: settingsRes.statusText,
              vodId,
            });
          }
        }
      } catch (error) {
        console.error("Failed to fetch VOD player data", error);
      }
    };

    void run();
    return () => {
      disposed = true;
    };
  }, [vodId]);

  useEffect(() => {
    if (!vodId) return;
    if (!showMarkers) return;
    if (markersLoadedVodRef.current === vodId) return;
    if (markersLoadingRef.current) return;

    let disposed = false;
    markersLoadingRef.current = true;

    const run = async () => {
      try {
        const authSuffix = buildAuthSuffix("local");

        const markersRes = await fetch(
          `/api/vod/${vodId}/markers${authSuffix}`,
        );
        if (!disposed && markersRes.ok) {
          const data = await markersRes.json();
          setMarkers(parseMarkersPayload(data));
          markersLoadedVodRef.current = vodId;
        } else if (!disposed) {
          console.warn("[Player] markers request failed", {
            status: markersRes.status,
            statusText: markersRes.statusText,
            vodId,
          });
        }
      } catch (error) {
        if (!disposed) {
          console.error("Failed to fetch markers", error);
        }
      } finally {
        markersLoadingRef.current = false;
      }
    };

    void run();
    return () => {
      disposed = true;
    };
  }, [showMarkers, vodId]);

  useEffect(() => {
    let disposed = false;

    const run = async () => {
      if (!liveId) return;

      try {
        const authSuffix = buildAuthSuffix("local");

        const [infoRes, settingsRes] = await Promise.all([
          fetch(`/api/user/${encodeURIComponent(liveId)}/live${authSuffix}`),
          fetch(`/api/settings${authSuffix}`),
        ]);

        if (!disposed && infoRes.ok) {
          setLiveInfo(await infoRes.json());
        }

        if (!disposed) {
          if (settingsRes.ok) {
            try {
              const remoteSettings =
                (await settingsRes.json()) as ExperienceSettings;
              setSettings((prev) => ({
                ...prev,
                ...normalizeExperienceSettings(remoteSettings),
              }));
            } catch (error) {
              console.error(
                "[Player] Failed to parse live settings payload",
                error,
              );
            }
          } else {
            console.warn("[Player] Live settings request failed", {
              status: settingsRes.status,
              statusText: settingsRes.statusText,
              liveId,
            });
          }
        }
      } catch (error) {
        console.error("Failed to fetch live player data", error);
      }
    };

    void run();
    return () => {
      disposed = true;
    };
  }, [liveId]);

  useInterval(
    () => {
      if (!vodId) return;

      const syncState = historySyncRef.current;
      if (Date.now() - syncState.lastTickAtMs > HISTORY_ACTIVE_WINDOW_MS) {
        return;
      }

      saveProgress();
    },
    vodId ? HISTORY_SYNC_INTERVAL_MS : null,
  );

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

  const handleBack = useCallback(() => {
    void flushHistoryBeforeExit();

    const fallbackPath =
      typeof returnPath === "string" && returnPath.startsWith("/")
        ? returnPath
        : "/";

    // Prefer real history back to preserve multi-level navigation.
    navigateBackInApp(navigate, fallbackPath);
  }, [flushHistoryBeforeExit, navigate, returnPath]);

  if (!source) {
    return (
      <div
        className="container"
        style={{ textAlign: "center", padding: "100px" }}
      >
        <div className="card glass">
          Missing player source. Please provide vod or live query parameter.
        </div>
      </div>
    );
  }

  return (
    <div className="player-container">
      {!isFullscreen && (
        <div className="player-top-bar">
          <div className="player-top-bar-content">
            <button onClick={handleBack} className="secondary-btn player-back-btn">
              <ArrowLeft size={20} />
            </button>
            <h2 className="player-header-title">
              {vodInfo?.title || liveInfo?.title || playerTitle}
            </h2>
          </div>
        </div>
      )}

      <div className="player-scroll-area">
        <div className="player-video-section">
          <div className="player-video-wrapper" style={{ aspectRatio: isFullscreen ? "auto" : "16/9" }}>
            <NSVPlayer
              source={playerMediaSource as { src: string; type?: string }}
              streamType={source.streamType}
              title={vodInfo?.title || liveInfo?.title || playerTitle}
              poster={playerPoster}
              startTime={initialTime}
              seekTo={seekTo}
              defaultQuality={normalizedDefaultQuality}
              isMobileLayout={isMobileLayout}
              isLandscape={isLandscape}
              autoPlay={false}
              className="nsv-main-player"
              onTimeUpdate={handlePlayerTimeUpdate}
              onDurationChange={setDuration}
              onPlayStateChange={setIsPlaying}
              onQualitySelection={handlePlayerQualitySelection}
              onSourceReady={handlePlayerSourceReady}
              onError={setPlayerError}
            />

            {!liveId && showMarkers && markers.length > 0 && (
              <MarkerPanel
                markers={markers}
                currentTime={currentTime}
                onSeek={(time) => {
                  setSeekTo(time);
                  setShowMarkers(false);
                }}
                onClose={() => setShowMarkers(false)}
              />
            )}
          </div>

          <div className={`container player-controls-container ${showChat ? "chat-visible" : ""}`}>
            {!isFullscreen && (
              <div className="glass player-actions-row">
                {!liveId && (
                  <button
                    onClick={() => setShowChatSearch((v) => !v)}
                    className="secondary-btn player-action-mini-btn"
                    title="Rechercher dans le chat"
                  >
                    <Search size={16} />
                    Rechercher chat
                  </button>
                )}

                {!liveId && (
                  <button
                    onClick={() => setShowMarkers((v) => !v)}
                    className="secondary-btn player-action-mini-btn"
                  >
                    Chapitres ({markers.length})
                  </button>
                )}

                <button
                  onClick={() => setShowChat((v) => !v)}
                  className="action-btn player-action-mini-btn"
                >
                  {showChat ? "Masquer le chat" : "Afficher le chat"}
                </button>
              </div>
            )}

            {downloadMode && vodId && (
              <ClipMode
                duration={duration}
                clipStart={clipStart}
                clipEnd={clipEnd}
                vodId={vodId}
                vodInfo={vodInfo}
                onSetStart={() => setClipStart(currentTime)}
                onSetEnd={() => setClipEnd(currentTime)}
                onDownloadStart={() => {
                  setClipStart(null);
                  setClipEnd(null);
                }}
              />
            )}

            {!isFullscreen && (vodInfo || liveInfo) && (
              <PlayerInfo vodInfo={vodInfo} liveInfo={liveInfo} />
            )}

            {playerError && <div className="player-error-container">{playerError}</div>}
          </div>
        </div>

        {showChat && !isFullscreen && (
          <div className="glass player-chat-container">
            {!liveId && showChatSearch && vodId && (
              <ChatSearch
                vodId={vodId}
                onSeek={(time) => {
                  setSeekTo(time);
                  setShowChatSearch(false);
                }}
                onClose={() => setShowChatSearch(false)}
              />
            )}
            {liveId ? (
              <LiveChatComponent liveId={liveId} chatScrollRef={chatScrollRef} />
            ) : (
              <>
                <div className="player-chat-header">STREAM CHAT REPLAY</div>

                <div ref={chatScrollRef} className="player-chat-messages">
                  {replayChatMessages.map((message) => (
                    <div key={message.id} className="chat-message-item">
                      <span className="chat-message-time">
                        {formatClock(message.contentOffsetSeconds)}
                      </span>
                      <span className="chat-message-author">
                        {message.commenter?.displayName || "Unknown"}:{" "}
                      </span>
                      <span className="chat-message-text">{extractChatMessageText(message)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
