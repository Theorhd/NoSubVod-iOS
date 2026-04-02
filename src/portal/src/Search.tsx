import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { UserInfo } from "../../shared/types";
import { formatViewers } from "../../shared/utils/formatters";
import { TopBar } from "./components/TopBar";

type SearchGame = {
  id: string;
  name: string;
  boxArtURL: string;
  __typename: "Game";
};

type SearchUser = UserInfo & {
  __typename: "User";
  stream?: {
    id: string;
    title: string;
    viewersCount: number;
    previewImageURL: string;
  } | null;
};

type SearchResult = SearchGame | SearchUser;

export default function Search() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const channels = useMemo(
    () =>
      results.filter(
        (result): result is SearchUser => result.__typename === "User",
      ),
    [results],
  );
  const liveStreams = useMemo(
    () => channels.filter((user) => user.stream != null),
    [channels],
  );
  const categories = useMemo(
    () =>
      results.filter(
        (result): result is SearchGame => result.__typename === "Game",
      ),
    [results],
  );

  const handleSearch = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setIsSearching(true);
    setHasSearched(true);

    try {
      const res = await fetch(`/api/search/global?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error("Failed to search");
      const data = (await res.json()) as SearchResult[];
      setResults(data);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("q", q);
        return next;
      });
    } catch (error) {
      console.error(error);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <>
      <TopBar mode="back" title="Search Twitch" />

      <div className="container">
        <div className="card">
          <form onSubmit={handleSearch}>
            <label htmlFor="globalSearch">Search Channels, Categories...</label>
            <div className="input-row">
              <input
                type="text"
                id="globalSearch"
                placeholder="What are you looking for?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                autoFocus
              />
              <button
                type="submit"
                className="action-btn"
                disabled={isSearching}
              >
                {isSearching ? "..." : "Search"}
              </button>
            </div>
          </form>
        </div>

        {hasSearched && !isSearching && results.length === 0 && (
          <div className="empty-state">No results found.</div>
        )}

        {categories.length > 0 && (
          <div className="block-section">
            <h2>Categories</h2>
            <div className="categories-grid">
              {categories.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  className="category-card"
                  onClick={() =>
                    navigate(
                      `/channel?category=${encodeURIComponent(game.name)}&categoryId=${encodeURIComponent(game.id)}`,
                    )
                  }
                >
                  <img src={game.boxArtURL} alt={game.name} />
                  <span>{game.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {liveStreams.length > 0 && (
          <div className="block-section">
            <h2>Live Streams</h2>
            <div className="vod-grid">
              {liveStreams.map((user) => (
                <div key={user.id} className="vod-card live-card">
                  <div className="vod-thumb-wrap">
                    <img
                      src={
                        user.stream?.previewImageURL ||
                        "https://static-cdn.jtvnw.net/ttv-static/404_preview-320x180.jpg"
                      }
                      alt={user.stream?.title}
                      className="vod-thumb"
                    />
                    <div className="vod-chip live-chip">LIVE</div>
                  </div>
                  <div className="vod-body">
                    <div className="vod-owner-row">
                      {user.profileImageURL && (
                        <img
                          src={user.profileImageURL}
                          alt={user.displayName}
                        />
                      )}
                      <span>{user.displayName}</span>
                    </div>
                    <h3 title={user.stream?.title}>
                      <button
                        type="button"
                        className="stretched-link"
                        style={{
                          background: "none",
                          border: "none",
                          color: "inherit",
                          font: "inherit",
                          padding: 0,
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                        onClick={() =>
                          navigate(
                            `/player?live=${encodeURIComponent(user.login)}`,
                          )
                        }
                      >
                        {user.stream?.title}
                      </button>
                    </h3>
                    <div className="vod-meta-row">
                      <span className="live-viewers">
                        {formatViewers(user.stream?.viewersCount || 0)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {channels.length > 0 && (
          <div className="block-section">
            <h2>Channels</h2>
            <div className="sub-list">
              {channels.map((user) => (
                <div key={user.id} className="sub-item">
                  <button
                    type="button"
                    className="sub-link"
                    onClick={() =>
                      navigate(
                        `/channel?user=${encodeURIComponent(user.login)}`,
                      )
                    }
                  >
                    <img src={user.profileImageURL} alt={user.displayName} />
                    <div className="name">{user.displayName}</div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
