import React from "react";
import { VideoMarker } from "../../../../shared/types";
import { formatSafeClock as formatClock } from "../../../../shared/utils/formatters";
import { Play, Tag, X } from "lucide-react";
import styles from "./MarkerPanel.module.scss";

interface MarkerPanelProps {
  markers: VideoMarker[];
  onSeek: (time: number) => void;
  onClose: () => void;
  currentTime?: number;
}

const MarkerPanel: React.FC<MarkerPanelProps> = ({
  markers,
  onSeek,
  onClose,
  currentTime = 0,
}) => {
  if (markers.length === 0) return null;

  return (
    <div className={`glass ${styles["extracted-style-1"]}`}>
      <div className={styles["extracted-style-2"]}>
        <h3 className={styles["extracted-style-3"]}>Chapitres</h3>
        <button
          onClick={onClose}
          className={`secondary-btn ${styles["extracted-style-4"]}`}
          aria-label="Fermer"
        >
          <X size={18} />
        </button>
      </div>

      <div className={`custom-marker-list ${styles["extracted-style-5"]}`}>
        {markers.map((marker, index) => {
          const nextTime = markers[index + 1]?.displayTime || Infinity;
          const isActive =
            currentTime >= marker.displayTime && currentTime < nextTime;

          return (
            <button
              key={marker.id}
              type="button"
              onClick={() => onSeek(marker.displayTime)}
              className="glass-hover"
              style={{
                display: "flex",
                width: "100%",
                textAlign: "left",
                background: isActive
                  ? "rgba(143, 87, 255, 0.2)"
                  : "rgba(255,255,255,0.03)",
                border: "1px solid",
                borderColor: isActive ? "var(--primary)" : "transparent",
                borderRadius: "var(--radius-md)",
                padding: "10px",
                marginBottom: "8px",
                cursor: "pointer",
                gap: "12px",
                alignItems: "center",
                transition: "all 0.2s var(--transition-fast)",
                color: "inherit",
              }}
            >
              <div className={styles["extracted-style-6"]}>
                {marker.url ? (
                  <img
                    src={marker.url}
                    alt=""
                    className={styles["extracted-style-7"]}
                  />
                ) : (
                  <Tag size={18} className={styles["extracted-style-8"]} />
                )}
              </div>

              <div className={styles["extracted-style-9"]}>
                <div
                  style={{
                    color: isActive ? "#fff" : "var(--text)",
                    fontWeight: 700,
                    fontSize: "0.85rem",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    marginBottom: "4px",
                  }}
                >
                  {marker.description}
                </div>
                <div
                  style={{
                    color: isActive ? "var(--primary)" : "var(--text-muted)",
                    fontSize: "0.8rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontWeight: 600,
                  }}
                >
                  <Play size={12} fill="currentColor" />
                  {formatClock(marker.displayTime)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default MarkerPanel;
