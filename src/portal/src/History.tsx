import React, { useEffect, useState } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import { HistoryVodEntry } from "../../shared/types";
import { formatRelative } from "../../shared/utils/formatters";
import { TopBar } from "./components/TopBar";
import { navigateToPlayer } from "./utils/navigation";
import Glass from "./components/Glass";
import "./styles/History.css";

type HistoryItemProps = Readonly<{
  entry: HistoryVodEntry;
  navigate: NavigateFunction;
}>;

function HistoryItemComponent({ entry, navigate }: HistoryItemProps) {
  const progress =
    entry.duration > 0
      ? Math.min(100, Math.max(0, (entry.timecode / entry.duration) * 100))
      : 0;

  return (
    <Glass className="history-item" cornerRadius={14} elasticity={0.15}>
      <button
        type="button"
        className="history-item-main"
        onClick={() =>
          navigateToPlayer(navigate, {
            vodId: entry.vodId,
          })
        }
      >
        <img
          src={
            entry.vod?.previewThumbnailURL ||
            "https://static-cdn.jtvnw.net/ttv-static/404_preview-320x180.jpg"
          }
          alt={entry.vod?.title || "VOD " + entry.vodId}
        />
        <div className="history-item-content">
          <h3 title={entry.vod?.title || entry.vodId}>
            {entry.vod?.title || "VOD " + entry.vodId}
          </h3>
          <div className="vod-meta-row">
            <span>{entry.vod?.owner?.displayName || "Unknown channel"}</span>
            <span>{entry.vod?.game?.name || "No category"}</span>
            <span>{formatRelative(entry.updatedAt)}</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: progress + "%" }} />
          </div>
        </div>
      </button>
    </Glass>
  );
}

export default function History() {
  const navigate = useNavigate();
  const [items, setItems] = useState<HistoryVodEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/history/list")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load history");
        return res.json();
      })
      .then((data: HistoryVodEntry[]) => {
        setItems(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <>
      <TopBar mode="back" title="Watch History" />

      <div className="container">
        {loading && <div className="status-line">Loading history...</div>}
        {error && <div className="error-text">{error}</div>}

        {!loading && !error && items.length === 0 && (
          <div className="empty-state">
            No history yet. Start watching a VOD to populate this page.
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="history-list">
            {items.map((entry) => (
              <HistoryItemComponent
                key={entry.vodId}
                entry={entry}
                navigate={navigate}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
