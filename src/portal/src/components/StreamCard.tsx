import React from "react";
import { LiveStream } from "../../../shared/types";
import { formatViewers, formatUptime } from "../../../shared/utils/formatters";
import { Users, Clock, Play } from "lucide-react";
import "../styles/StreamCard.css";

type StreamCardProps = {
  stream: LiveStream;
  onWatch: (login: string) => void;
  onCategoryClick?: (categoryName: string) => void;
  onChannelClick?: (login: string) => void;
  showBroadcaster?: boolean;
};

export const StreamCard = React.memo<StreamCardProps>(
  ({
    stream,
    onWatch,
    onCategoryClick,
    onChannelClick,
    showBroadcaster = true,
  }) => {
    return (
      <div className="stream-card glass-hover">
        <div className="vod-thumb-wrap">
          <img
            src={
              stream.previewImageURL?.replace("-{width}x{height}", "") ||
              "https://static-cdn.jtvnw.net/ttv-static/404_preview-320x180.jpg"
            }
            alt={stream.title}
            className="vod-thumb"
            loading="lazy"
          />
          <div className="live-badge pulse">LIVE</div>

          <div className="vod-play-overlay stream-play-overlay">
            <div className="stream-play-icon">
              <Play size={24} fill="currentColor" />
            </div>
          </div>

          <button
            className="stretched-link stream-link-btn"
            aria-label={`Regarder le live de ${stream.broadcaster.displayName}`}
            onClick={() => onWatch(stream.broadcaster.login)}
          />
        </div>

        <div className="vod-body" style={{ position: "relative", zIndex: 3 }}>
          {showBroadcaster && stream.broadcaster && (
            <div className="vod-meta stream-broadcaster">
              {stream.broadcaster.profileImageURL && (
                <img
                  src={stream.broadcaster.profileImageURL}
                  alt={stream.broadcaster.displayName}
                  className="stream-avatar"
                />
              )}
              <button
                type="button"
                className="stream-name-btn"
                style={{ cursor: onChannelClick ? "pointer" : "default" }}
                onClick={(e) => {
                  if (onChannelClick) {
                    e.stopPropagation();
                    onChannelClick(stream.broadcaster.login);
                  }
                }}
              >
                {stream.broadcaster.displayName}
              </button>
            </div>
          )}

          <h3
            className="vod-title stream-title-text"
            title={stream.title}
          >
            {stream.title}
          </h3>

          <div className="vod-meta stream-meta-footer">
            <div className="stream-meta-left">
              {stream.game?.name && onCategoryClick ? (
                <button
                  type="button"
                  className="secondary-btn stream-category-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCategoryClick(stream.game!.name);
                  }}
                >
                  {stream.game.name}
                </button>
              ) : (
                <span className="stream-category-text">
                  {stream.game?.name || "No category"}
                </span>
              )}

              <span className="stream-viewers">
                <Users size={12} />
                {formatViewers(stream.viewerCount)}
              </span>
            </div>
          </div>

          {stream.startedAt && (
            <div className="stream-uptime">
              <Clock size={12} />
              Uptime: {formatUptime(stream.startedAt)}
            </div>
          )}
        </div>
      </div>
    );
  },
);

StreamCard.displayName = "StreamCard";
