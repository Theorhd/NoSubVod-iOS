import React from "react";
import { useNavigate } from "react-router-dom";
import { HistoryVodEntry } from "../../../../shared/types";
import { History as HistoryIcon, ChevronRight } from "lucide-react";
import { navigateToPlayer } from "../../utils/navigation";

interface HistoryPreviewProps {
  readonly historyPreview: HistoryVodEntry[];
}

function formatProgress(timecode: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, (timecode / duration) * 100));
}

const HistoryPreview = React.memo(({ historyPreview }: HistoryPreviewProps) => {
  const navigate = useNavigate();

  return (
    <div style={{ marginBottom: "32px" }}>
      <div className="section-header">
        <h2>
          <HistoryIcon size={20} /> Continue Watching
        </h2>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => navigate("/history")}
          style={{ fontSize: "0.8rem", padding: "6px 12px" }}
        >
          View All <ChevronRight size={14} />
        </button>
      </div>

      {historyPreview.length === 0 ? (
        <div
          className="card glass"
          style={{ textAlign: "center", color: "var(--text-muted)" }}
        >
          No recent history.
        </div>
      ) : (
        <div style={{ display: "grid", gap: "12px" }}>
          {historyPreview.map((entry) => {
            const progress = formatProgress(entry.timecode, entry.duration);

            return (
              <button
                key={entry.vodId}
                className="glass-hover"
                style={{
                  display: "flex",
                  gap: "16px",
                  padding: "12px",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  alignItems: "center",
                  border: "none",
                  background: "transparent",
                  textAlign: "left",
                  color: "inherit",
                  width: "100%",
                }}
                onClick={() =>
                  navigateToPlayer(navigate, {
                    vodId: entry.vodId,
                  })
                }
                type="button"
              >
                <div
                  style={{
                    position: "relative",
                    width: "120px",
                    aspectRatio: "16/9",
                    borderRadius: "8px",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={
                      entry.vod?.previewThumbnailURL ||
                      "https://static-cdn.jtvnw.net/ttv-static/404_preview-320x180.jpg"
                    }
                    alt={entry.vod?.title || `VOD ${entry.vodId}`}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: "3px",
                      background: "rgba(255,255,255,0.1)",
                    }}
                  >
                    <div
                      style={{
                        width: `${progress}%`,
                        height: "100%",
                        background: "var(--primary)",
                      }}
                    />
                  </div>
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <h3
                    style={{
                      margin: 0,
                      fontSize: "0.95rem",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {entry.vod?.title || `VOD ${entry.vodId}`}
                  </h3>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      marginTop: "4px",
                      fontSize: "0.8rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    <span style={{ color: "var(--text)", fontWeight: 600 }}>
                      {entry.vod?.owner?.displayName || "Unknown channel"}
                    </span>
                    <span>•</span>
                    <span>{entry.vod?.game?.name || "No category"}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

HistoryPreview.displayName = "HistoryPreview";
export default HistoryPreview;
