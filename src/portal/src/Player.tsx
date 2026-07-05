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
import { useHistorySync } from "./hooks/useHistorySync";
import { useVideoQuality } from "./hooks/useVideoQuality";
import { useChatReplay } from "./hooks/useChatReplay";

const DEFAULT_SETTINGS: ExperienceSettings = {
  oneSync: false,
  defaultVideoQuality: "auto",
};

type PlayerRouteState = {
  from?: string;
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
    <div
      style={{
        position: "absolute",
        top: "0",
        right: "0",
        width: "100%",
        height: "100%",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        background: "rgba(7, 8, 15, 0.95)",
        borderLeft: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          padding: "16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          gap: "8px",
          alignItems: "center",
        }}
      >
        <div style={{ position: "relative", flex: 1 }}>
          <input
            autoFocus
            type="text"
            className="search-input"
            placeholder="Rechercher dans le chat..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            style={{ width: "100%", margin: 0, paddingRight: "40px" }}
          />
          <Search
            size={18}
            style={{
              position: "absolute",
              right: "12px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
              pointerEvents: "none",
            }}
          />
        </div>
        <button
          className="secondary-btn"
          onClick={onClose}
          style={{
            width: "40px",
            height: "40px",
            padding: 0,
            borderRadius: "50%",
          }}
        >
          <X size={18} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {results.length === 0 && !searching && keyword && (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-muted)",
              marginTop: "20px",
            }}
          >
            Aucun résultat trouvé pour &quot;{keyword}&quot;
          </div>
        )}
        {results.map((res: any) => (
          <button
            key={res.id}
            onClick={() => onSeek(res.contentOffsetSeconds)}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "12px",
              borderBottom: "1px solid var(--border)",
              cursor: "pointer",
              borderRadius: "8px",
              transition: "0.2s",
              marginBottom: "4px",
              background: "transparent",
              border: "none",
              display: "block",
            }}
            className="hover-card"
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "4px",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontWeight: 800,
                  color: "var(--primary)",
                  fontSize: "0.8rem",
                }}
              >
                {res.commenter?.displayName}
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                {formatClock(res.contentOffsetSeconds)}
              </span>
            </div>
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--text)",
                lineHeight: "1.4",
              }}
            >
              {res.message}
            </div>
          </button>
        ))}
        {searching && (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-muted)",
              marginTop: "20px",
            }}
          >
            Recherche en cours...
          </div>
        )}
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
  const { isMobileLayout } = useResponsive();
  const navigate = useNavigate();
  const mediaKey = useMemo(() => {
    if (vodId) return `vod:${vodId}`;
    if (liveId) return `live:${liveId}`;
    return "none";
  }, [vodId, liveId]);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const previousMediaKeyRef = useRef<string>(mediaKey);
  const lastRenderedSecondRef = useRef(-1);
  const markersLoadedVodRef = useRef<string | null>(null);
  const markersLoadingRef = useRef(false);

  const [showChat, setShowChat] = useState(false);
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [showMarkers, setShowMarkers] = useState(false);
  const [markers, setMarkers] = useState<VideoMarker[]>([]);
  const [vodInfo, setVodInfo] = useState<VOD | null>(null);
  const [liveInfo, setLiveInfo] = useState<LiveStream | null>(null);
  const [initialTime, setInitialTime] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const [clipStart, setClipStart] = useState<number | null>(null);
  const [clipEnd, setClipEnd] = useState<number | null>(null);
  const [settings, setSettings] =
    useState<ExperienceSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // CUSTOM HOOKS
  const { flushHistoryBeforeExit, updateObservedTime, historySyncRef } =
    useHistorySync(vodId, currentTimeRef, durationRef, isPlaying);

  const {
    source,
    normalizedDefaultQuality,
    handlePlayerSourceReady,
    handlePlayerQualitySelection,
    resetQualityState,
  } = useVideoQuality(
    vodId,
    liveId,
    settings.defaultVideoQuality,
    historySyncRef.current.lastObservedTime,
    currentTime,
  );

  const {
    shouldLoadChat,
    replayChatMessages,
    resetChatState,
    handleTimeUpdateForChat,
  } = useChatReplay(
    vodId,
    liveId,
    showChat,
    isFullscreen,
    currentTime,
    currentTimeRef,
  );

  const shouldUpdateUiTime = showMarkers || shouldLoadChat || downloadMode;

  const handlePlayerTimeUpdate = useCallback(
    (time: number) => {
      const previousTime = currentTimeRef.current;
      currentTimeRef.current = time;

      handleTimeUpdateForChat(time, previousTime);

      if (vodId) {
        updateObservedTime(time);
      }

      const roundedSecond = Math.floor(time);
      if (
        shouldUpdateUiTime &&
        roundedSecond !== lastRenderedSecondRef.current
      ) {
        lastRenderedSecondRef.current = roundedSecond;
        setCurrentTime(time);
      }
    },
    [handleTimeUpdateForChat, shouldUpdateUiTime, updateObservedTime, vodId],
  );

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
    setMarkers([]);
    setVodInfo(null);
    setLiveInfo(null);
    setCurrentTime(0);
    setDuration(0);
    setInitialTime(0);
    setSeekTo(null);
    setClipStart(null);
    setClipEnd(null);

    lastRenderedSecondRef.current = -1;
    markersLoadedVodRef.current = null;
    markersLoadingRef.current = false;

    resetQualityState();
    resetChatState();
  }, [mediaKey, resetQualityState, resetChatState]);

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
          updateObservedTime(savedTime);
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
  }, [vodId, updateObservedTime]);

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

  const handleBack = useCallback(() => {
    void flushHistoryBeforeExit();

    const fallbackPath =
      typeof returnPath === "string" && returnPath.startsWith("/")
        ? returnPath
        : "/";

    navigateBackInApp(navigate, fallbackPath);
  }, [flushHistoryBeforeExit, navigate, returnPath]);

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

  const playerTitle = useMemo(
    () => resolvePlayerTitle(vodId, liveId),
    [vodId, liveId],
  );

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
        <div
          className="top-bar"
          style={{
            position: "relative",
            zIndex: 10,
            background: "rgba(7, 8, 15, 0.8)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
              flex: 1,
              minWidth: 0,
            }}
          >
            <button
              onClick={handleBack}
              className="secondary-btn"
              style={{
                width: "40px",
                height: "40px",
                padding: 0,
                borderRadius: "50%",
              }}
            >
              <ArrowLeft size={20} />
            </button>
            <h2
              style={{
                fontSize: "1rem",
                fontWeight: 800,
                margin: "2px 0 0",
                whiteSpace: "normal",
                lineHeight: 1.35,
                wordBreak: "break-word",
                overflowWrap: "anywhere",
                flex: 1,
                minWidth: 0,
              }}
            >
              {vodInfo?.title || liveInfo?.title || playerTitle}
            </h2>
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            background: "#000",
          }}
        >
          <div
            style={{
              width: "100%",
              position: "relative",
              aspectRatio: isFullscreen ? "auto" : "16/9",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <NSVPlayer
              source={
                source as { src: string; type?: string; streamType?: any }
              }
              streamType={source.streamType}
              title={vodInfo?.title || liveInfo?.title || playerTitle}
              poster={playerPoster}
              startTime={initialTime}
              seekTo={seekTo}
              defaultQuality={normalizedDefaultQuality}
              isMobileLayout={isMobileLayout}
              autoPlay
              className="nsv-main-player"
              onTimeUpdate={handlePlayerTimeUpdate}
              onDurationChange={setDuration}
              onPlayStateChange={setIsPlaying}
              onQualitySelection={handlePlayerQualitySelection}
              onSourceReady={(url) => handlePlayerSourceReady(url, setSeekTo)}
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

          <div
            className="container"
            style={{ paddingBottom: showChat ? "20px" : "100px" }}
          >
            {!isFullscreen && (
              <div
                className="glass"
                style={{
                  marginBottom: "16px",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-md)",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                {!liveId && (
                  <button
                    onClick={() => setShowChatSearch((v) => !v)}
                    className="secondary-btn"
                    style={{
                      fontSize: "0.8rem",
                      padding: "6px 12px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                    title="Rechercher dans le chat"
                  >
                    <Search size={16} />
                    Rechercher chat
                  </button>
                )}

                {!liveId && (
                  <button
                    onClick={() => setShowMarkers((v) => !v)}
                    className="secondary-btn"
                    style={{ fontSize: "0.8rem", padding: "6px 12px" }}
                  >
                    Chapitres ({markers.length})
                  </button>
                )}

                <button
                  onClick={() => setShowChat((v) => !v)}
                  className="action-btn"
                  style={{ fontSize: "0.8rem", padding: "6px 12px" }}
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

            {playerError && (
              <div
                style={{
                  marginTop: "16px",
                  color: "var(--danger)",
                  padding: "16px",
                  borderRadius: "var(--radius-md)",
                  background: "rgba(255,107,135,0.1)",
                }}
              >
                {playerError}
              </div>
            )}
          </div>
        </div>

        {showChat && (
          <div
            className="glass"
            style={{
              width: "100%",
              flex: 1,
              minHeight: "400px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              position: "relative",
            }}
          >
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
              <LiveChatComponent
                liveId={liveId}
                chatScrollRef={chatScrollRef}
              />
            ) : (
              <>
                <div
                  style={{
                    padding: "16px",
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 800,
                    color: "var(--text)",
                    fontSize: "0.85rem",
                  }}
                >
                  STREAM CHAT REPLAY
                </div>

                <div
                  ref={chatScrollRef}
                  style={{ flex: 1, overflowY: "auto", padding: "16px" }}
                >
                  {replayChatMessages.map((message) => (
                    <div
                      key={message.id}
                      style={{
                        marginBottom: "12px",
                        fontSize: "0.85rem",
                        lineHeight: "1.5",
                      }}
                    >
                      <span
                        style={{
                          color: "var(--text-muted)",
                          marginRight: "8px",
                          fontSize: "0.75rem",
                        }}
                      >
                        {formatClock(message.contentOffsetSeconds)}
                      </span>
                      <span
                        style={{ fontWeight: 800, color: "var(--primary)" }}
                      >
                        {message.commenter?.displayName || "Unknown"}:{" "}
                      </span>
                      <span style={{ color: "var(--text)" }}>
                        {extractChatMessageText(message)}
                      </span>
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
