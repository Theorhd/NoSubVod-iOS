import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  HistoryVodEntry,
  LiveStatusMap,
  SubEntry,
  UserInfo,
  WatchlistEntry,
} from "../../shared/types";
import ChannelSearchCard from "./components/home/ChannelSearchCard";
import MySubsList from "./components/home/MySubsList";
import HistoryPreview from "./components/home/HistoryPreview";
import WatchlistPreview from "./components/home/WatchlistPreview";
import { TopBar } from "./components/TopBar";
import { usePageVisibility } from "../../shared/hooks/usePageVisibility";
import "./styles/Home.css";

async function fetchJson<T>(
  url: string,
  signal: AbortSignal,
): Promise<T | null> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as T;
}

function readLocalSubs(): SubEntry[] {
  const saved = localStorage.getItem("nsv_subs");
  if (!saved) {
    return [];
  }

  try {
    return JSON.parse(saved) as SubEntry[];
  } catch {
    return [];
  }
}

function normalizeSubEntry(entry: SubEntry): SubEntry {
  return {
    login: entry.login.trim().toLowerCase(),
    displayName: entry.displayName,
    profileImageURL: entry.profileImageURL,
  };
}

function dedupeSubs(entries: SubEntry[]): SubEntry[] {
  const byLogin = new Map<string, SubEntry>();
  for (const entry of entries) {
    const normalized = normalizeSubEntry(entry);
    if (!normalized.login) continue;
    if (!byLogin.has(normalized.login)) {
      byLogin.set(normalized.login, normalized);
    }
  }
  return [...byLogin.values()];
}

async function resolveSubsFromStorage(
  signal: AbortSignal,
  remoteSubsData: SubEntry[] | null,
): Promise<{ subs: SubEntry[]; clearLegacyLocal: boolean }> {
  const localSubs = dedupeSubs(readLocalSubs());

  if (!remoteSubsData) {
    return { subs: localSubs, clearLegacyLocal: false };
  }

  const normalizedRemote = dedupeSubs(remoteSubsData);
  if (normalizedRemote.length > 0) {
    return { subs: normalizedRemote, clearLegacyLocal: true };
  }

  if (localSubs.length === 0) {
    return { subs: [], clearLegacyLocal: false };
  }

  await Promise.all(
    localSubs.map(async (entry) => {
      try {
        await fetch("/api/subs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry),
          signal,
        });
      } catch {
        // Keep local fallback when migration cannot complete now.
      }
    }),
  );

  const migratedSubs = await fetchJson<SubEntry[]>("/api/subs", signal);
  if (migratedSubs && migratedSubs.length > 0) {
    return {
      subs: dedupeSubs(migratedSubs),
      clearLegacyLocal: true,
    };
  }

  return { subs: localSubs, clearLegacyLocal: false };
}

export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const isPageVisible = usePageVisibility();
  const [subs, setSubs] = useState<SubEntry[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [historyPreview, setHistoryPreview] = useState<HistoryVodEntry[]>([]);
  const [liveStatus, setLiveStatus] = useState<LiveStatusMap>({});

  const [showModal, setShowModal] = useState(false);
  const [streamerInput, setStreamerInput] = useState("");
  const [modalError, setModalError] = useState("");
  const [isSearchingStreamer, setIsSearchingStreamer] = useState(false);

  const [channelSearch, setChannelSearch] = useState("");
  const [searchResults, setSearchResults] = useState<UserInfo[]>([]);
  const [isSearchingChannels, setIsSearchingChannels] = useState(false);

  const subsLiveStatusKey = useMemo(() => {
    if (subs.length === 0) return "";
    return subs
      .map((sub) => sub.login.toLowerCase())
      .sort((a, b) => a.localeCompare(b))
      .join(",");
  }, [subs]);

  const loadHomeData = useCallback(async (signal: AbortSignal) => {
    try {
      const [watchlistData, historyData, remoteSubsData] = await Promise.all([
        fetchJson<WatchlistEntry[]>("/api/watchlist", signal),
        fetchJson<HistoryVodEntry[]>("/api/history/list?limit=3", signal),
        fetchJson<SubEntry[]>("/api/subs", signal),
      ]);

      if (signal.aborted) return;

      if (watchlistData) {
        setWatchlist(watchlistData);
      }

      if (historyData) {
        setHistoryPreview(historyData);
      }

      const resolvedSubs = await resolveSubsFromStorage(signal, remoteSubsData);
      if (signal.aborted) return;

      setSubs(resolvedSubs.subs);
      if (resolvedSubs.clearLegacyLocal) {
        localStorage.removeItem("nsv_subs");
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      console.error("Failed to fetch home data", error);
    }
  }, []);

  useEffect(() => {
    if (!isPageVisible) {
      return;
    }

    const controller = new AbortController();
    void loadHomeData(controller.signal);

    return () => {
      controller.abort();
    };
  }, [isPageVisible, loadHomeData, location.key]);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    const loadLiveStatus = async () => {
      if (!subsLiveStatusKey) {
        setLiveStatus({});
        return;
      }

      try {
        const res = await fetch(
          `/api/live/status?logins=${encodeURIComponent(subsLiveStatusKey)}`,
          { signal: controller.signal },
        );
        if (disposed) return;
        if (!res.ok) {
          setLiveStatus({});
          return;
        }

        setLiveStatus((await res.json()) as LiveStatusMap);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.error("Failed to fetch live status for subs", error);
        setLiveStatus({});
      }
    };

    void loadLiveStatus();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [subsLiveStatusKey]);

  const saveSubsLocal = (newSubs: SubEntry[]) => {
    setSubs(newSubs);
    localStorage.setItem("nsv_subs", JSON.stringify(newSubs));
  };

  const saveSubServer = async (entry: SubEntry): Promise<boolean> => {
    try {
      const normalized = normalizeSubEntry(entry);
      const res = await fetch("/api/subs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalized),
      });

      if (!res.ok) return false;

      setSubs((prev) => {
        if (prev.some((s) => s.login === normalized.login)) return prev;
        return [...prev, normalized];
      });
      return true;
    } catch {
      return false;
    }
  };

  const removeSubServer = async (login: string): Promise<boolean> => {
    try {
      const normalizedLogin = login.trim().toLowerCase();
      const res = await fetch(
        `/api/subs/${encodeURIComponent(normalizedLogin)}`,
        {
          method: "DELETE",
        },
      );

      if (!res.ok) return false;
      setSubs((prev) => prev.filter((s) => s.login !== normalizedLogin));
      return true;
    } catch {
      return false;
    }
  };

  const removeFromWatchlist = async (vodId: string) => {
    try {
      const res = await fetch(`/api/watchlist/${vodId}`, { method: "DELETE" });
      if (res.ok) {
        setWatchlist((prev) => prev.filter((w) => w.vodId !== vodId));
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleChannelSearch = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const query = channelSearch.trim();
    if (!query) return;

    setIsSearchingChannels(true);
    try {
      const res = await fetch(
        `/api/search/channels?q=${encodeURIComponent(query)}`,
      );
      if (!res.ok) throw new Error("Failed to search channels");
      const data = (await res.json()) as UserInfo[];
      setSearchResults(data);
    } catch (error) {
      console.error(error);
      setSearchResults([]);
    } finally {
      setIsSearchingChannels(false);
    }
  };

  const handleAddSub = async () => {
    const username = streamerInput.trim().toLowerCase();
    if (!username) return;

    if (subs.some((sub) => sub.login === username)) {
      setModalError("Already subbed to this user.");
      return;
    }

    setIsSearchingStreamer(true);
    setModalError("");

    try {
      const res = await fetch(`/api/user/${username}`);
      if (!res.ok) throw new Error("User not found");
      const user = (await res.json()) as UserInfo;

      const newSub: SubEntry = {
        login: user.login,
        displayName: user.displayName,
        profileImageURL: user.profileImageURL,
      };

      const savedOnServer = await saveSubServer(newSub);
      if (!savedOnServer) {
        saveSubsLocal([...subs, newSub]);
      }

      setShowModal(false);
      setStreamerInput("");
    } catch (error: any) {
      setModalError(error?.message || "Error finding user.");
    } finally {
      setIsSearchingStreamer(false);
    }
  };

  const handleDeleteSub = async (e: React.MouseEvent, login: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!globalThis.confirm("Remove this streamer?")) {
      return;
    }

    const removedOnServer = await removeSubServer(login);
    if (!removedOnServer) {
      saveSubsLocal(subs.filter((sub) => sub.login !== login));
    }
  };

  return (
    <>
      <TopBar
        mode="logo"
        title="NoSubVod"
        actions={
          <div className="home-actions">
            <button
              className="action-btn home-icon-btn"
              onClick={() => setShowModal(true)}
              aria-label="Add sub"
              type="button"
            >
              +
            </button>
            <button
              className="secondary-btn home-icon-btn"
              onClick={() => navigate("/settings")}
              aria-label="Open settings"
              title="Settings"
              type="button"
            >
              ⚙
            </button>
          </div>
        }
      />

      <div className="container">
        <ChannelSearchCard
          channelSearch={channelSearch}
          setChannelSearch={setChannelSearch}
          isSearchingChannels={isSearchingChannels}
          searchResults={searchResults}
          handleChannelSearch={handleChannelSearch}
        />

        <MySubsList
          subs={subs}
          liveStatus={liveStatus}
          handleDeleteSub={handleDeleteSub}
        />

        <HistoryPreview historyPreview={historyPreview} />

        <WatchlistPreview
          watchlist={watchlist}
          removeFromWatchlist={removeFromWatchlist}
        />
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Sub to a Streamer</h3>
            <label htmlFor="streamerInput">Twitch Username</label>
            <input
              type="text"
              id="streamerInput"
              placeholder="e.g. zerator"
              value={streamerInput}
              onChange={(e) => setStreamerInput(e.target.value)}
              autoComplete="off"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleAddSub();
                }
              }}
            />
            {modalError && <div className="error-text">{modalError}</div>}
            <div className="btn-row">
              <button
                className="action-btn cancel"
                onClick={() => setShowModal(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="action-btn"
                onClick={() => void handleAddSub()}
                disabled={isSearchingStreamer}
                type="button"
              >
                {isSearchingStreamer ? "Searching..." : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
