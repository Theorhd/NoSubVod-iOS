import React from "react";
import { VOD, HistoryEntry } from "../../../shared/types";
import { formatTime, formatViews } from "../../../shared/utils/formatters";
import { Download as DownloadIcon, Clock, Users, Play } from "lucide-react";
import DownloadMenu from "./DownloadMenu";

export type VODCardProps = {
  vod: VOD;
  onWatch: (vodId: string) => void;
  onAddToWatchlist?: (e: React.MouseEvent, vod: VOD) => void;
  historyEntry?: HistoryEntry;
  showOwner?: boolean;
  hideDownload?: boolean;
};

export const VODCard = React.memo<VODCardProps>(
  ({
    vod,
    onWatch,
    onAddToWatchlist,
    historyEntry,
    showOwner,
    hideDownload,
  }) => {
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null);

    const handleDownloadClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (menuOpen) {
        setMenuOpen(false);
      } else {
        setAnchorRect(
          (e.currentTarget as HTMLButtonElement).getBoundingClientRect(),
        );
        setMenuOpen(true);
      }
    };

    const progress =
      historyEntry && historyEntry.duration > 0
        ? Math.min(100, (historyEntry.timecode / historyEntry.duration) * 100)
        : 0;

    return (
      <div className="vod-card glass-hover">
        <div className="vod-thumb-wrap">
          <img
            src={vod.previewThumbnailURL}
            alt={vod.title}
            className="vod-thumb"
          />
          <div
            className="vod-badge"
            style={{ display: "flex", alignItems: "center", gap: "4px" }}
          >
            <Clock size={12} />
            {formatTime(vod.lengthSeconds)}
          </div>

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
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "var(--primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#000",
                boxShadow: "0 0 20px var(--primary-glow)",
              }}
            >
              <Play size={24} fill="currentColor" />
            </div>
          </div>

          <button
            className="stretched-link"
            aria-label={`Regarder la VOD: ${vod.title}`}
            onClick={() => onWatch(vod.id)}
            style={{ background: "none", border: "none", padding: 0 }}
          />

          {onAddToWatchlist && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAddToWatchlist(e, vod);
              }}
              className="secondary-btn"
              style={{
                position: "absolute",
                zIndex: 5,
                top: "8px",
                right: "8px",
                width: "32px",
                height: "32px",
                padding: 0,
                borderRadius: "50%",
                fontSize: "18px",
              }}
              title="Add to watch later"
            >
              +
            </button>
          )}

          {progress > 0 && (
            <div
              className="progress-track"
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "3px",
                borderRadius: 0,
                background: "rgba(255,255,255,0.1)",
              }}
            >
              <div
                className="progress-fill"
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  borderRadius: 0,
                }}
              />
            </div>
          )}
        </div>

        <div className="vod-body" style={{ position: "relative", zIndex: 3 }}>
          {showOwner && vod.owner && (
            <div
              className="vod-meta"
              style={{ marginBottom: "8px", color: "var(--text)" }}
            >
              {vod.owner.profileImageURL && (
                <img
                  src={vod.owner.profileImageURL}
                  alt={vod.owner.displayName}
                  style={{ width: "20px", height: "20px", borderRadius: "50%" }}
                />
              )}
              <span style={{ fontWeight: 600 }}>
                {vod.owner.displayName || "Unknown Streamer"}
              </span>
            </div>
          )}

          <h3 className="vod-title" title={vod.title}>
            {vod.title}
          </h3>

          <div
            className="vod-meta"
            style={{ justifyContent: "space-between", marginTop: "8px" }}
          >
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <span
                style={{
                  color: "var(--primary)",
                  fontWeight: 600,
                  fontSize: "0.75rem",
                }}
              >
                {vod.game?.name || "No Category"}
              </span>
              <span
                style={{ display: "flex", alignItems: "center", gap: "4px" }}
              >
                <Users size={12} />
                {formatViews(vod.viewCount)}
              </span>
            </div>

            {!hideDownload && (
              <div style={{ position: "relative", zIndex: 5 }}>
                <button
                  type="button"
                  onClick={handleDownloadClick}
                  className="secondary-btn"
                  style={{
                    width: "32px",
                    height: "32px",
                    padding: 0,
                    borderRadius: "50%",
                  }}
                  title="Télécharger"
                >
                  <DownloadIcon size={14} />
                </button>
                {menuOpen && anchorRect && (
                  <DownloadMenu
                    vodId={vod.id}
                    title={vod.title}
                    duration={vod.lengthSeconds}
                    anchorRect={anchorRect}
                    onClose={() => setMenuOpen(false)}
                  />
                )}
              </div>
            )}
          </div>
          <div
            style={{
              marginTop: "8px",
              fontSize: "0.7rem",
              color: "var(--text-muted)",
            }}
          >
            {new Date(vod.createdAt).toLocaleDateString()}
          </div>
        </div>

        <style>{`
        .vod-card:hover .vod-play-overlay { opacity: 1 !important; }
      `}</style>
      </div>
    );
  },
);

VODCard.displayName = "VODCard";
