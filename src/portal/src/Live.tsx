import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { LiveStream, LiveStreamsPage, SubEntry } from "../../shared/types";
import { useInfiniteScroll } from "./hooks/useInfiniteScroll";
import { StreamCard } from "./components/StreamCard";
import { TopBar } from "./components/TopBar";

const PAGE_SIZE = 24;

type LiveMode = "all" | "search" | "category";

type TopCategory = {
  id: string;
  name: string;
  boxArtURL: string;
};

const computeScore = (stream: LiveStream, subLogins: Set<string>): number => {
  const login = stream.broadcaster.login.toLowerCase();
  const subBoost = subLogins.has(login) ? 32 : 0;
  const frenchBoost = (stream.language || "").toLowerCase() === "fr" ? 8 : 0;
  const viewerScore = Math.log10((stream.viewerCount || 0) + 10) * 10;
  const uptimeHours = Math.max(
    0,
    (Date.now() - new Date(stream.startedAt).getTime()) / 3600000,
  );
  const freshnessBoost = Math.max(0, 4 - Math.min(uptimeHours, 4));

  return viewerScore + subBoost + frenchBoost + freshnessBoost;
};

const rankStreams = (
  streams: LiveStream[],
  subLogins: Set<string>,
): LiveStream[] => {
  return [...streams]
    .map((stream) => ({
      stream,
      score: computeScore(stream, subLogins),
    }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.stream);
};

export default function Live() {
  const navigate = useNavigate();

  const [mode, setMode] = useState<LiveMode>("all");
  const [searchInput, setSearchInput] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [topCategories, setTopCategories] = useState<TopCategory[]>([]);

  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [subLogins, setSubLogins] = useState<Set<string>>(new Set());
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const seenIdsRef = useRef<Set<string>>(new Set());
  const isFetchingRef = useRef(false);
  const isInitialLoadingRef = useRef(true);

  const resetStreamState = useCallback(() => {
    setStreams([]);
    seenIdsRef.current = new Set();
    setNextCursor(null);
    setHasMore(true);
    setError("");
    isInitialLoadingRef.current = true;
    isFetchingRef.current = false;
  }, []);

  const appendRankedStreams = useCallback(
    (incoming: LiveStream[]) => {
      const fresh = incoming.filter((stream) => {
        if (seenIdsRef.current.has(stream.id)) return false;
        seenIdsRef.current.add(stream.id);
        return true;
      });
      if (fresh.length === 0) return;
      setStreams((current) => rankStreams([...current, ...fresh], subLogins));
    },
    [subLogins],
  );

  const fetchPage = useCallback(
    async (cursor?: string | null, categoryName?: string | null) => {
      if (isFetchingRef.current) return;
      if (!isInitialLoadingRef.current && !hasMore) return;

      isFetchingRef.current = true;
      setError("");
      if (isInitialLoadingRef.current) {
        setIsInitialLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const endpoint = categoryName ? "/api/live/category" : "/api/live";
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (cursor) params.set("cursor", cursor);
        if (categoryName) params.set("name", categoryName);

        const res = await fetch(`${endpoint}?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load streams");
        const payload = (await res.json()) as LiveStreamsPage;

        appendRankedStreams(payload.items || []);
        setNextCursor(payload.nextCursor || null);
        setHasMore(Boolean(payload.hasMore));
      } catch (err: any) {
        setError(err?.message || "Failed to load live streams");
      } finally {
        isFetchingRef.current = false;
        isInitialLoadingRef.current = false;
        setIsInitialLoading(false);
        setIsLoadingMore(false);
      }
    },
    [appendRankedStreams, hasMore],
  );

  const fetchSearch = useCallback(async (q: string) => {
    isFetchingRef.current = true;
    setError("");
    setIsInitialLoading(true);
    try {
      const res = await fetch(
        `/api/live/search?q=${encodeURIComponent(q)}&limit=${PAGE_SIZE}`,
      );
      if (!res.ok) throw new Error("Search failed");
      const payload = (await res.json()) as LiveStreamsPage;
      const fresh = (payload.items || []).filter((s) => {
        if (seenIdsRef.current.has(s.id)) return false;
        seenIdsRef.current.add(s.id);
        return true;
      });
      setStreams(fresh);
      setHasMore(false);
      setNextCursor(null);
    } catch (err: any) {
      setError(err?.message || "Search failed");
    } finally {
      isFetchingRef.current = false;
      isInitialLoadingRef.current = false;
      setIsInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const [settingsRes, catsRes] = await Promise.all([
          fetch("/api/settings"),
          fetch("/api/live/top-categories"),
        ]);

        let oneSync = false;
        if (settingsRes.ok) {
          const s = await settingsRes.json();
          oneSync = Boolean(s.oneSync);
        }

        let subEntries: SubEntry[] = [];
        if (oneSync) {
          const subsRes = await fetch("/api/subs");
          if (subsRes.ok) subEntries = await subsRes.json();
        } else {
          const local = localStorage.getItem("nsv_subs");
          subEntries = local ? JSON.parse(local) : [];
        }
        setSubLogins(new Set(subEntries.map((e) => e.login.toLowerCase())));

        if (catsRes.ok) setTopCategories(await catsRes.json());
      } catch {
        // Silently fail init data
      }
      void fetchPage(null);
    };
    void init();
  }, [fetchPage]);

  useEffect(() => {
    setStreams((current) => rankStreams(current, subLogins));
  }, [subLogins]);

  const { lastElementRef } = useInfiniteScroll({
    isLoading: isFetchingRef.current || mode === "search",
    hasMore,
    onLoadMore: () => {
      if (mode === "all") void fetchPage(nextCursor);
      else if (mode === "category" && activeCategory)
        void fetchPage(nextCursor, activeCategory);
    },
  });

  const switchToAll = useCallback(() => {
    setMode("all");
    setActiveCategory(null);
    setSearchInput("");
    resetStreamState();
    void fetchPage(null);
  }, [resetStreamState, fetchPage]);

  const switchToCategory = useCallback(
    (name: string) => {
      setMode("category");
      setActiveCategory(name);
      setSearchInput("");
      resetStreamState();
      void fetchPage(null, name);
    },
    [resetStreamState, fetchPage],
  );

  const handleSearchSubmit = useCallback(
    (e: React.SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      const q = searchInput.trim();
      if (!q) {
        switchToAll();
        return;
      }
      setMode("search");
      setActiveCategory(null);
      resetStreamState();
      void fetchSearch(q);
    },
    [searchInput, resetStreamState, fetchSearch, switchToAll],
  );

  const emptyStateMessage = useMemo(() => {
    if (mode === "search") return "Aucun live trouvé pour cette recherche.";
    if (mode === "category")
      return `Aucun live pour la catégorie "${activeCategory}".`;
    return "Aucun stream disponible pour le moment.";
  }, [mode, activeCategory]);

  const headerLabel = useMemo(() => {
    if (mode === "category" && activeCategory) return activeCategory;
    if (mode === "search") return `"${searchInput}"`;
    return "En direct maintenant";
  }, [mode, activeCategory, searchInput]);

  const renderContent = () => {
    if (isInitialLoading) {
      return <div className="status-line">Chargement des streams...</div>;
    }

    if (error) {
      return <div className="error-text">{error}</div>;
    }

    if (streams.length === 0) {
      return <div className="empty-state">{emptyStateMessage}</div>;
    }

    return (
      <>
        <div className="vod-grid">
          {streams.map((stream) => (
            <StreamCard
              key={stream.id}
              stream={stream}
              onWatch={(login) =>
                navigate(`/player?live=${encodeURIComponent(login)}`)
              }
              onCategoryClick={switchToCategory}
              showBroadcaster
            />
          ))}
        </div>
        <div
          ref={lastElementRef}
          style={{ height: "20px", width: "100%" }}
          aria-hidden="true"
        />
        {isLoadingMore && (
          <div className="status-line">Chargement de plus de streams...</div>
        )}
      </>
    );
  };

  return (
    <>
      <TopBar mode="logo" title="Live Twitch" onLogoClick={switchToAll} />
      <div className="container">
        <div className="card live-search-card">
          <form className="live-search-form" onSubmit={handleSearchSubmit}>
            <input
              type="text"
              className="live-search-input"
              placeholder="Chercher par catégorie, mot-clé, chaîne..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Rechercher des lives"
            />
            <button type="submit" className="action-btn">
              Rechercher
            </button>
            {mode !== "all" && (
              <button
                type="button"
                className="secondary-btn"
                onClick={switchToAll}
              >
                ✕ Réinitialiser
              </button>
            )}
          </form>

          {topCategories.length > 0 && (
            <div className="live-top-categories">
              <span className="live-cats-label">Populaires&nbsp;:</span>
              {topCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`live-cat-pill${activeCategory === cat.name ? " active" : ""}`}
                  onClick={() =>
                    activeCategory === cat.name
                      ? switchToAll()
                      : switchToCategory(cat.name)
                  }
                  title={cat.name}
                >
                  {cat.boxArtURL && (
                    <img
                      src={cat.boxArtURL}
                      alt=""
                      className="live-cat-pill-art"
                    />
                  )}
                  <span>{cat.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card live-intro-card">
          <h2>{headerLabel}</h2>
          {mode === "all" && (
            <p className="card-subtitle">
              Flux dynamique classé par popularité, abonnements et fraîcheur.
            </p>
          )}
          <div className="live-count">
            {streams.length} stream{streams.length === 1 ? "" : "s"} chargé
            {streams.length === 1 ? "" : "s"}
          </div>
        </div>

        {renderContent()}
      </div>
    </>
  );
}
