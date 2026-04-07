import React from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { SubEntry, SubNotificationPreferences } from "../../shared/types";
import { StreamCard } from "./components/StreamCard";
import { VODCard } from "./components/VODCard";
import { StreamerInfoCard } from "./components/streamerInfoCard";
import { TopBar } from "./components/TopBar";
import { useChannelData } from "./hooks/useChannelData";
import { navigateToPlayer } from "./utils/navigation";
import { ensureNativeNotificationPermission } from "./utils/nativeNotifications";

const normalizeSubLogin = (value: string): string => value.trim().toLowerCase();

const DEFAULT_SUB_NOTIFICATIONS: SubNotificationPreferences = {
  enabled: false,
  live: true,
  vod: true,
};

const normalizeSubEntry = (entry: SubEntry): SubEntry => {
  const notifications: SubNotificationPreferences = {
    ...DEFAULT_SUB_NOTIFICATIONS,
    ...entry.notifications,
  };

  if (notifications.enabled && !notifications.live && !notifications.vod) {
    notifications.live = true;
    notifications.vod = true;
  }

  return {
    ...entry,
    login: normalizeSubLogin(entry.login),
    notifications,
  };
};

function readLocalSubs(): SubEntry[] {
  const raw = localStorage.getItem("nsv_subs");
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as SubEntry[];
    return parsed.map(normalizeSubEntry);
  } catch {
    return [];
  }
}

function persistLocalSubs(entries: SubEntry[]): boolean {
  try {
    localStorage.setItem("nsv_subs", JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

const toSubMap = (entries: SubEntry[]): Map<string, SubEntry> => {
  const map = new Map<string, SubEntry>();
  entries.forEach((entry) => {
    const normalized = normalizeSubEntry(entry);
    if (!normalized.login) return;
    map.set(normalized.login, normalized);
  });
  return map;
};

const toSubEntries = (subsByLogin: Map<string, SubEntry>): SubEntry[] =>
  Array.from(subsByLogin.values());

export default function Channel() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const user = searchParams.get("user");
  const category = searchParams.get("category");
  const categoryId = searchParams.get("categoryId");
  const navigate = useNavigate();
  const [subsByLogin, setSubsByLogin] = React.useState<Map<string, SubEntry>>(
    new Map(),
  );
  const [subsLoaded, setSubsLoaded] = React.useState(false);
  const [isAddingSub, setIsAddingSub] = React.useState(false);
  const [notificationsUpdatingLogin, setNotificationsUpdatingLogin] =
    React.useState<string | null>(null);
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
            setSubsByLogin(toSubMap(remoteSubs));
            setSubsLoaded(true);
          }
          return;
        }
      } catch {
        // Fallback handled below.
      }

      if (!cancelled) {
        setSubsByLogin(toSubMap(readLocalSubs()));
        setSubsLoaded(true);
      }
    };

    void loadSubs();

    return () => {
      cancelled = true;
    };
  }, [location.key]);

  React.useEffect(() => {
    if (!subsLoaded) return;
    persistLocalSubs(toSubEntries(subsByLogin));
  }, [subsByLogin, subsLoaded]);

  const streamerLogin = streamerInfo
    ? normalizeSubLogin(streamerInfo.login)
    : "";
  const streamerSubEntry = streamerLogin
    ? subsByLogin.get(streamerLogin) || null
    : null;

  const streamerNotifications =
    streamerSubEntry?.notifications || DEFAULT_SUB_NOTIFICATIONS;

  const isStreamerSubbed = streamerSubEntry !== null;

  const isStreamerNotificationsEnabled = Boolean(
    streamerNotifications.enabled &&
    (streamerNotifications.live || streamerNotifications.vod),
  );

  const isStreamerNotificationsUpdating =
    streamerLogin !== "" && notificationsUpdatingLogin === streamerLogin;

  React.useEffect(() => {
    setSubFeedback(null);
  }, [streamerInfo?.login]);

  const handleAddStreamerToSubs = React.useCallback(async () => {
    if (!streamerInfo) return;

    const normalizedLogin = normalizeSubLogin(streamerInfo.login);
    if (!normalizedLogin) return;

    if (subsByLogin.has(normalizedLogin)) {
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
      notifications: { ...DEFAULT_SUB_NOTIFICATIONS },
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

      setSubsByLogin((prev) => {
        const next = new Map(prev);
        next.set(normalizedLogin, normalizeSubEntry(subEntry));
        return next;
      });
      setSubFeedback({
        type: "success",
        message: "Streamer ajoute a la liste des subs.",
      });
    } catch {
      const localMap = new Map(subsByLogin);
      localMap.set(normalizedLogin, normalizeSubEntry(subEntry));

      if (!persistLocalSubs(toSubEntries(localMap))) {
        setSubFeedback({
          type: "error",
          message: "Impossible d'ajouter ce streamer pour le moment.",
        });
        setIsAddingSub(false);
        return;
      }

      setSubsByLogin(localMap);
      setSubFeedback({
        type: "success",
        message: "Streamer ajoute localement a la liste des subs.",
      });
    } finally {
      setIsAddingSub(false);
    }
  }, [streamerInfo, subsByLogin]);

  const handleToggleStreamerNotifications = React.useCallback(async () => {
    if (!streamerInfo) return;

    const normalizedLogin = normalizeSubLogin(streamerInfo.login);
    if (!normalizedLogin) return;

    const currentSub = subsByLogin.get(normalizedLogin);
    if (!currentSub) return;

    const currentNotifications: SubNotificationPreferences = {
      ...DEFAULT_SUB_NOTIFICATIONS,
      ...currentSub.notifications,
    };

    const currentlyEnabled = Boolean(
      currentNotifications.enabled &&
      (currentNotifications.live || currentNotifications.vod),
    );
    const shouldEnable = !currentlyEnabled;

    if (shouldEnable) {
      const permissionGranted = await ensureNativeNotificationPermission();
      if (!permissionGranted) {
        setSubFeedback({
          type: "error",
          message: "Notifications iOS refusees. Active-les dans les reglages.",
        });
        return;
      }
    }

    const nextNotifications: SubNotificationPreferences = {
      enabled: shouldEnable,
      live: true,
      vod: true,
    };

    setNotificationsUpdatingLogin(normalizedLogin);
    setSubFeedback(null);

    try {
      const res = await fetch(
        `/api/subs/${encodeURIComponent(normalizedLogin)}/notifications`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextNotifications),
        },
      );

      if (!res.ok) {
        throw new Error("Failed to update sub notifications");
      }

      const updatedSub = normalizeSubEntry((await res.json()) as SubEntry);
      setSubsByLogin((prev) => {
        const next = new Map(prev);
        next.set(normalizedLogin, updatedSub);
        return next;
      });

      setSubFeedback({
        type: "success",
        message: shouldEnable
          ? "Notifications live et VOD activees."
          : "Notifications desactivees.",
      });
    } catch {
      const localMap = new Map(subsByLogin);
      localMap.set(
        normalizedLogin,
        normalizeSubEntry({
          ...currentSub,
          notifications: nextNotifications,
        }),
      );

      if (!persistLocalSubs(toSubEntries(localMap))) {
        setSubFeedback({
          type: "error",
          message: "Impossible de mettre a jour les notifications.",
        });
        setNotificationsUpdatingLogin((value) =>
          value === normalizedLogin ? null : value,
        );
        return;
      }

      setSubsByLogin(localMap);
      setSubFeedback({
        type: "success",
        message: shouldEnable
          ? "Notifications activees localement."
          : "Notifications desactivees localement.",
      });
    } finally {
      setNotificationsUpdatingLogin((value) =>
        value === normalizedLogin ? null : value,
      );
    }
  }, [streamerInfo, subsByLogin]);

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
              notificationsEnabled={isStreamerNotificationsEnabled}
              notificationsUpdating={isStreamerNotificationsUpdating}
              onToggleNotifications={() =>
                void handleToggleStreamerNotifications()
              }
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
