import React from "react";
import { VOD, HistoryEntry } from "../../../shared/types";
import { formatTime, formatViews } from "../../../shared/utils/formatters";
import { Clock, Users, Play } from "lucide-react";
import styles from "./VODCard.module.scss";

export type VODCardProps = {
  vod: VOD;
  onWatch: (vodId: string) => void;
  onAddToWatchlist?: (e: React.MouseEvent, vod: VOD) => void;
  historyEntry?: HistoryEntry;
  showOwner?: boolean;
};

export const VODCard = React.memo<VODCardProps>(
  ({ vod, onWatch, onAddToWatchlist, historyEntry, showOwner }) => {
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
            loading="lazy"
          />
          <div className={`vod-badge ${styles["extracted-style-1"]}`}>
            <Clock size={12} />
            {formatTime(vod.lengthSeconds)}
          </div>

          <div className={`vod-play-overlay ${styles["extracted-style-2"]}`}>
            <div className={styles["extracted-style-3"]}>
              <Play size={24} fill="currentColor" />
            </div>
          </div>

          <button
            className={`stretched-link ${styles["extracted-style-4"]}`}
            aria-label={`Regarder la VOD: ${vod.title}`}
            onClick={() => onWatch(vod.id)}
          />

          {onAddToWatchlist && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAddToWatchlist(e, vod);
              }}
              className={`secondary-btn ${styles["extracted-style-5"]}`}
              title="Add to watch later"
            >
              +
            </button>
          )}

          {progress > 0 && (
            <div className={`progress-track ${styles["extracted-style-6"]}`}>
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

        <div className={`vod-body ${styles["extracted-style-7"]}`}>
          {showOwner && vod.owner && (
            <div className={`vod-meta ${styles["extracted-style-8"]}`}>
              {vod.owner.profileImageURL && (
                <img
                  src={vod.owner.profileImageURL}
                  alt={vod.owner.displayName}
                  className={styles["extracted-style-9"]}
                />
              )}
              <span className={styles["extracted-style-10"]}>
                {vod.owner.displayName || "Unknown Streamer"}
              </span>
            </div>
          )}

          <h3 className="vod-title" title={vod.title}>
            {vod.title}
          </h3>

          <div className={`vod-meta ${styles["extracted-style-11"]}`}>
            <div className={styles["extracted-style-12"]}>
              <span className={styles["extracted-style-13"]}>
                {vod.game?.name || "No Category"}
              </span>
              <span className={styles["extracted-style-14"]}>
                <Users size={12} />
                {formatViews(vod.viewCount)}
              </span>
            </div>
          </div>
          <div className={styles["extracted-style-15"]}>
            {new Date(vod.createdAt).toLocaleDateString()}
          </div>
        </div>
      </div>
    );
  },
);

VODCard.displayName = "VODCard";
