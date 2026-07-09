import React from "react";
import { VirtuosoGrid } from "react-virtuoso";
import { useNavigate } from "react-router-dom";
import { WatchlistEntry } from "../../../../shared/types";
import { Bookmark, X, Play } from "lucide-react";
import { navigateToPlayer } from "../../utils/navigation";
import styles from "./WatchlistPreview.module.scss";

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
      <div className={styles["extracted-style-1"]}>
        <div className="section-header">
          <h2>
            <Bookmark size={20} /> Watch Later
          </h2>
        </div>

        <VirtuosoGrid
          useWindowScroll
          data={watchlist}
          listClassName={`vod-grid ${styles["extracted-style-2"]}`}
          itemContent={(index, vod) => (
            <div
              key={vod.vodId}
              className={`vod-card glass-hover ${styles["extracted-style-3"]}`}
            >
              <div className="vod-thumb-wrap">
                <img
                  src={vod.previewThumbnailURL}
                  alt={vod.title}
                  className="vod-thumb"
                  loading="lazy"
                />
                <div
                  className={`vod-play-overlay ${styles["extracted-style-4"]}`}
                >
                  <div className={styles["extracted-style-5"]}>
                    <Play size={20} fill="currentColor" />
                  </div>
                </div>

                <button
                  className={`stretched-link ${styles["extracted-style-6"]}`}
                  aria-label={`Regarder ${vod.title}`}
                  onClick={() =>
                    navigateToPlayer(navigate, {
                      vodId: vod.vodId,
                    })
                  }
                />

                <button
                  type="button"
                  className={`secondary-btn ${styles["extracted-style-7"]}`}
                  aria-label={`Supprimer ${vod.title} de la liste`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeFromWatchlist(vod.vodId);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
              <div className={`vod-body ${styles["extracted-style-8"]}`}>
                <div title={vod.title} className={styles["extracted-style-9"]}>
                  {vod.title}
                </div>
              </div>
            </div>
          )}
        />
      </div>
    );
  },
);

WatchlistPreview.displayName = "WatchlistPreview";
export default WatchlistPreview;
