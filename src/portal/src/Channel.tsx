import React from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { SubEntry } from "../../shared/types";
import { StreamCard } from "./components/StreamCard";
import { VODCard } from "./components/VODCard";
import { StreamerInfoCard } from "./components/streamerInfoCard";
import { TopBar } from "./components/TopBar";
import { useChannelData } from "./hooks/useChannelData";
import { navigateToPlayer } from "./utils/navigation";

const normalizeSubLogin = (value: string): string => value.trim().toLowerCase();

function readLocalSubs(): SubEntry[] {
  const raw = localStorage.getItem("nsv_subs");
  if (!raw) return [];

  try {
    return JSON.parse(raw) as SubEntry[];
  } catch {
    return [];
  }
}

const toSubLoginSet = (entries: SubEntry[]): Set<string> =>
  new Set(
    entries.map((entry) => normalizeSubLogin(entry.login)).filter(Boolean),
  );

export default function Channel() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const user = searchParams.get("user");
  const category = searchParams.get("category");
  const categoryId = searchParams.get("categoryId");
  const navigate = useNavigate();
  const [subsLogins, setSubsLogins] = React.useState<Set<string>>(new Set());
  const [isAddingSub, setIsAddingSub] = React.useState(false);
  const [subFeedback, setSubFeedback] = React.useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const {
    title,
    isUserMode,
    isCategoryMode,
    vods,
    liveStream,
    streamerInfo,
    history,
    loading,
    error,
    catLiveStreams,
    catLiveHasMore,
    catLiveLoading,
    catVodHasMore,
    catVodLoading,
    loadMoreCatVods,
    loadMoreCatLive,
    addToWatchlist,
  } = useChannelData({
    user,
    category,
    categoryId,
    refreshKey: location.key,
  });

  React.useEffect(() => {
    let cancelled = false;

    const loadSubs = async () => {
      try {
        const res = await fetch("/api/subs");
        if (res.ok) {
          const remoteSubs = (await res.json()) as SubEntry[];
          if (!cancelled) {
            setSubsLogins(toSubLoginSet(remoteSubs));
          }
          return;
        }
      } catch {
        // Fallback handled below.
      }

      if (!cancelled) {
        setSubsLogins(toSubLoginSet(readLocalSubs()));
      }
    };

    void loadSubs();

    return () => {
      cancelled = true;
    };
  }, [location.key]);

  const isStreamerSubbed = Boolean(
    streamerInfo && subsLogins.has(normalizeSubLogin(streamerInfo.login)),
  );

  React.useEffect(() => {
    setSubFeedback(null);
  }, [streamerInfo?.login]);

  const handleAddStreamerToSubs = React.useCallback(async () => {
    if (!streamerInfo) return;

    const normalizedLogin = normalizeSubLogin(streamerInfo.login);
    if (!normalizedLogin) return;

    if (subsLogins.has(normalizedLogin)) {
      setSubFeedback({
        type: "success",
        message: "Streamer deja present dans ta liste de subs.",
      });
      return;
    }

    setIsAddingSub(true);
    setSubFeedback(null);

    const subEntry: SubEntry = {
      login: normalizedLogin,
      displayName: streamerInfo.displayName || streamerInfo.login,
      profileImageURL: streamerInfo.profileImageURL,
    };

    try {
      const res = await fetch("/api/subs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subEntry),
      });

      if (!res.ok) {
        throw new Error("Failed to add sub");
      }

      setSubsLogins((prev) => new Set(prev).add(normalizedLogin));
      setSubFeedback({
        type: "success",
        message: "Streamer ajoute a la liste des subs.",
      });
    } catch {
      const localSubs = readLocalSubs();
      const alreadyLocal = localSubs.some(
        (entry) => normalizeSubLogin(entry.login) === normalizedLogin,
      );

      if (!alreadyLocal) {
        try {
          localStorage.setItem(
            "nsv_subs",
            JSON.stringify([...localSubs, subEntry]),
          );
        } catch {
          setSubFeedback({
            type: "error",
            message: "Impossible d'ajouter ce streamer pour le moment.",
          });
          setIsAddingSub(false);
          return;
        }
      }

      setSubsLogins((prev) => new Set(prev).add(normalizedLogin));
      setSubFeedback({
        type: "success",
        message: "Streamer ajoute localement a la liste des subs.",
      });
    } finally {
      setIsAddingSub(false);
    }
  }, [streamerInfo, subsLogins]);

  return (
    <>
      <TopBar mode="back" title={title} />

      <div className="container">
        {loading && <div className="status-line">Loading...</div>}
        {error && <div className="error-text">{error}</div>}

        {!loading &&
          !error &&
          vods.length === 0 &&
          catLiveStreams.length === 0 &&
          !liveStream && <div className="empty-state">No content found.</div>}

        {!loading && !error && isUserMode && streamerInfo && (
          <div className="block-section" style={{ marginTop: 0 }}>
            <StreamerInfoCard
              streamer={streamerInfo}
              isSubbed={isStreamerSubbed}
              isAdding={isAddingSub}
              onAddToSubs={() => void handleAddStreamerToSubs()}
            />

            {subFeedback && (
              <div
                className={
                  subFeedback.type === "success" ? "success-text" : "error-text"
                }
              >
                {subFeedback.message}
              </div>
            )}
          </div>
        )}

        {/* User live (user-channel mode) */}
        {!loading && !error && liveStream && isUserMode && (
          <div className="block-section" style={{ marginTop: 0 }}>
            <h2>Live</h2>
            <div className="vod-grid">
              <StreamCard
                key={liveStream.id}
                stream={liveStream}
                onWatch={(login) =>
                  navigateToPlayer(navigate, {
                    liveId: login,
                  })
                }
              />
            </div>
          </div>
        )}

        {/* Category live streams */}
        {!loading && !error && isCategoryMode && catLiveStreams.length > 0 && (
          <div className="block-section" style={{ marginTop: 0 }}>
            <div className="section-header-row">
              <h2>Lives en ce moment</h2>
              <span className="section-count">
                {catLiveStreams.length} stream
                {catLiveStreams.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="vod-grid">
              {catLiveStreams.map((stream) => (
                <StreamCard
                  key={stream.id}
                  stream={stream}
                  onWatch={(login) =>
                    navigateToPlayer(navigate, {
                      liveId: login,
                    })
                  }
                />
              ))}
            </div>
            {catLiveHasMore && (
              <div className="load-more-row">
                <button
                  type="button"
                  className="load-more-btn"
                  onClick={() => void loadMoreCatLive()}
                  disabled={catLiveLoading}
                >
                  {catLiveLoading ? "Chargement..." : "Voir plus de lives"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* VODs */}
        {!loading && !error && vods.length > 0 && (
          <div
            className="block-section"
            style={{
              marginTop: catLiveStreams.length > 0 || liveStream ? "16px" : "0",
            }}
          >
            <div className="section-header-row">
              <h2>VODs</h2>
              <span className="section-count">
                {vods.length} VOD{vods.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="vod-grid">
              {vods.map((vod) => {
                const hist = history[vod.id];
                return (
                  <VODCard
                    key={vod.id}
                    vod={vod}
                    onWatch={(id) =>
                      navigateToPlayer(navigate, {
                        vodId: id,
                      })
                    }
                    historyEntry={hist}
                    onAddToWatchlist={(e, vodItem) => {
                      e.stopPropagation();
                      void addToWatchlist(vodItem);
                    }}
                  />
                );
              })}
            </div>
            {catVodHasMore && (
              <div className="load-more-row">
                <button
                  type="button"
                  className="load-more-btn"
                  onClick={() => void loadMoreCatVods()}
                  disabled={catVodLoading}
                >
                  {catVodLoading ? "Chargement..." : "Voir plus de VODs"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
