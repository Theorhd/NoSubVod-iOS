import React from "react";
import { useNavigate } from "react-router-dom";
import { WatchlistEntry } from "../../../../shared/types";
import { Bookmark, X, Play } from "lucide-react";

interface WatchlistPreviewProps {
  readonly watchlist: WatchlistEntry[];
  readonly removeFromWatchlist: (vodId: string) => Promise<void>;
}

const WatchlistPreview = React.memo(
  ({ watchlist, removeFromWatchlist }: WatchlistPreviewProps) => {
    const navigate = useNavigate();

    if (watchlist.length === 0) {
      return null;
    }

    return (
      <div style={{ marginBottom: "32px" }}>
        <div className="section-header">
          <h2>
            <Bookmark size={20} /> Watch Later
          </h2>
        </div>

        <div
          className="vod-grid"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          }}
        >
          {watchlist.map((vod) => (
            <div
              key={vod.vodId}
              className="vod-card glass-hover"
              style={{ position: "relative" }}
            >
              <div className="vod-thumb-wrap">
                <img
                  src={vod.previewThumbnailURL}
                  alt={vod.title}
                  className="vod-thumb"
                />
                <div
                  className="vod-play-overlay"
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(143, 87, 255, 0.2)",
                    opacity: 0,
                    transition: "opacity 0.3s ease",
                    pointerEvents: "none",
                    zIndex: 2,
                  }}
                >
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "50%",
                      background: "var(--primary)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#000",
                      boxShadow: "0 0 16px var(--primary-glow)",
                    }}
                  >
                    <Play size={20} fill="currentColor" />
                  </div>
                </div>

                <button
                  className="stretched-link"
                  aria-label={`Regarder ${vod.title}`}
                  onClick={() => navigate(`/player?vod=${vod.vodId}`)}
                  style={{ background: "none", border: "none", padding: 0 }}
                />

                <button
                  type="button"
                  className="secondary-btn"
                  aria-label={`Supprimer ${vod.title} de la liste`}
                  style={{
                    position: "absolute",
                    top: "8px",
                    right: "8px",
                    width: "28px",
                    height: "28px",
                    padding: 0,
                    borderRadius: "50%",
                    background: "rgba(0,0,0,0.5)",
                    border: "none",
                    zIndex: 5,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeFromWatchlist(vod.vodId);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
              <div
                className="vod-body"
                style={{ padding: "10px", position: "relative", zIndex: 1 }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={vod.title}
                >
                  {vod.title}
                </div>
              </div>

              <style>{`
              .vod-card:hover .vod-play-overlay { opacity: 1 !important; }
            `}</style>
            </div>
          ))}
        </div>
      </div>
    );
  },
);

WatchlistPreview.displayName = "WatchlistPreview";
export default WatchlistPreview;
