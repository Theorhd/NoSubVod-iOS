import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Search, X, Download } from "lucide-react";
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
import DownloadMenu from "./components/DownloadMenu";
import PlayerInfo from "./components/player/PlayerInfo";
import { formatSafeClock as formatClock } from "../../shared/utils/formatters";
import PlayerRTC from "./PlayerRTC";
import { useResponsive } from "./hooks/useResponsive";
import { normalizeExperienceSettings } from "./utils/experienceSettings";
import { navigateBackInApp } from "./utils/navigation";
import { buildAuthSuffix } from "./utils/authTokens";
import "./styles/Player.css";
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
        {searching && (
          <div className="chat-search-loading">Recherche en cours...</div>
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
  const { isMobileLayout, isLandscape } = useResponsive();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [markers, setMarkers] = useState<VideoMarker[]>([]);
  const [vodInfo, setVodInfo] = useState<VOD | null>(null);
  const [liveInfo, setLiveInfo] = useState<LiveStream | null>(null);
  const [isLoadingPlayerInfo, setIsLoadingPlayerInfo] = useState(
    !!(vodId || liveId),
  );

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
    vodInfo,
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
    if (!vodId) return;

    let disposed = false;
    setIsLoadingPlayerInfo(true);
    setPlayerError(null);

    const run = async () => {
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
        } else if (!disposed && !infoRes.ok) {
          setPlayerError("Impossible de charger les informations du VOD.");
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
        if (!disposed) {
          setPlayerError("Erreur réseau lors du chargement des données VOD.");
        }
      } finally {
        if (!disposed) {
          setIsLoadingPlayerInfo(false);
        }
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
        } else if (!disposed && !infoRes.ok) {
          setPlayerError("Impossible de charger les informations du live.");
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
        if (!disposed) {
          setPlayerError(
            "Erreur réseau lors du chargement des données du live.",
          );
        }
      } finally {
        if (!disposed) {
          setIsLoadingPlayerInfo(false);
        }
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

  if (playerError) {
    return (
      <div
        className="container"
        style={{ textAlign: "center", padding: "100px" }}
      >
        <div
          className="card glass"
          style={{ color: "var(--danger-color, #ff4444)" }}
        >
          <p>{playerError}</p>
          <button
            className="action-btn"
            onClick={() => window.location.reload()}
            style={{ marginTop: "1rem" }}
            type="button"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

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
            <button
              onClick={handleBack}
              className="secondary-btn player-back-btn"
            >
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
          <div
            className="player-video-wrapper"
            style={{ aspectRatio: isFullscreen ? "auto" : "16/9" }}
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
              isLandscape={isLandscape}
              autoPlay={false}
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
            className={`container player-controls-container ${showChat ? "chat-visible" : ""}`}
          >
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

                {!liveId && (
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={() => setShowDownloadMenu((v) => !v)}
                      className="secondary-btn player-action-mini-btn"
                    >
                      <Download size={16} />
                      Télécharger
                    </button>
                    {showDownloadMenu && vodId && (
                      <DownloadMenu
                        vodId={vodId}
                        title={vodInfo?.title}
                        duration={duration}
                        onClose={() => setShowDownloadMenu(false)}
                      />
                    )}
                  </div>
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
                onClose={() => {
                  const newParams = new URLSearchParams(searchParams);
                  newParams.delete("downloadMode");
                  setSearchParams(newParams, { replace: true });
                }}
              />
            )}

            {!isFullscreen && (vodInfo || liveInfo) && (
              <PlayerInfo vodInfo={vodInfo} liveInfo={liveInfo} />
            )}

            {playerError && (
              <div className="player-error-container">{playerError}</div>
            )}
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
              <LiveChatComponent
                liveId={liveId}
                chatScrollRef={chatScrollRef}
              />
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
                      <span className="chat-message-text">
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
