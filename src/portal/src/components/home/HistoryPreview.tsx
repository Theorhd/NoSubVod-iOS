import React from "react";
import { useNavigate } from "react-router-dom";
import { HistoryVodEntry } from "../../../../shared/types";
import { History as HistoryIcon, ChevronRight } from "lucide-react";
import { navigateToPlayer } from "../../utils/navigation";
import styles from "./HistoryPreview.module.scss";

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
    <div className={styles["extracted-style-1"]}>
      <div className="section-header">
        <h2>
          <HistoryIcon size={20} /> Continue Watching
        </h2>
        <button
          type="button"
          className={`secondary-btn ${styles["extracted-style-2"]}`}
          onClick={() => navigate("/history")}
        >
          View All <ChevronRight size={14} />
        </button>
      </div>

      {historyPreview.length === 0 ? (
        <div className={`card glass ${styles["extracted-style-3"]}`}>
          No recent history.
        </div>
      ) : (
        <div className={styles["extracted-style-4"]}>
          {historyPreview.map((entry) => {
            const progress = formatProgress(entry.timecode, entry.duration);

            return (
              <button
                key={entry.vodId}
                className={`glass-hover ${styles["extracted-style-5"]}`}
                onClick={() =>
                  navigateToPlayer(navigate, {
                    vodId: entry.vodId,
                  })
                }
                type="button"
              >
                <div className={styles["extracted-style-6"]}>
                  <img
                    src={
                      entry.vod?.previewThumbnailURL ||
                      "https://static-cdn.jtvnw.net/ttv-static/404_preview-320x180.jpg"
                    }
                    alt={entry.vod?.title || `VOD ${entry.vodId}`}
                    className={styles["extracted-style-7"]}
                  />
                  <div className={styles["extracted-style-8"]}>
                    <div
                      style={{
                        width: `${progress}%`,
                        height: "100%",
                        background: "var(--primary)",
                      }}
                    />
                  </div>
                </div>

                <div className={styles["extracted-style-9"]}>
                  <h3 className={styles["extracted-style-10"]}>
                    {entry.vod?.title || `VOD ${entry.vodId}`}
                  </h3>
                  <div className={styles["extracted-style-11"]}>
                    <span className={styles["extracted-style-12"]}>
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
