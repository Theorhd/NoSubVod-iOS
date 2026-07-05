import React from "react";
import { useNavigate } from "react-router-dom";
import { VOD, LiveStream } from "../../../../shared/types";
import "../../styles/PlayerInfo.css";

interface PlayerInfoProps {
  vodInfo: VOD | null;
  liveInfo: LiveStream | null;
}

const Uptime: React.FC<{ startedAt: string }> = ({ startedAt }) => {
  const [uptime, setUptime] = React.useState("");

  React.useEffect(() => {
    const update = () => {
      const diff = Date.now() - new Date(startedAt).getTime();
      if (diff < 0) return setUptime("");
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setUptime(h > 0 ? `${h}h ${m}m` : `${m}m`);
    };

    update();
    const int = setInterval(update, 60000);
    return () => clearInterval(int);
  }, [startedAt]);

  return <span>{uptime}</span>;
};

const PlayerInfo: React.FC<PlayerInfoProps> = ({ vodInfo, liveInfo }) => {
  const navigate = useNavigate();
  if (!vodInfo && !liveInfo) return null;

  const broadcaster = liveInfo ? liveInfo.broadcaster : vodInfo?.owner;
  const game = liveInfo ? liveInfo.game : vodInfo?.game;

  const handleStreamerClick = () => {
    if (broadcaster?.login) {
      navigate(`/channel?user=${encodeURIComponent(broadcaster.login)}`);
    }
  };

  const handleCategoryClick = () => {
    if (game?.name) {
      const categoryIdParam = (game as any).id
        ? `&categoryId=${encodeURIComponent((game as any).id)}`
        : "";
      navigate(
        `/channel?category=${encodeURIComponent(game.name)}${categoryIdParam}`,
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, handler: () => void) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handler();
    }
  };

  return (
    <div className="player-info-container">
      <div className="player-info-content">
        <button
          type="button"
          onClick={handleStreamerClick}
          onKeyDown={(e) => handleKeyDown(e, handleStreamerClick)}
          aria-label={`Go to ${broadcaster?.displayName || "streamer"}'s channel`}
          className="streamer-avatar-btn"
        >
          <img
            src={broadcaster?.profileImageURL || ""}
            alt={broadcaster?.displayName || "Profile"}
            className="streamer-avatar-img"
          />
        </button>

        <div className="player-info-main">
          <div className="player-info-header">
            <h1 className="player-info-title">
              {liveInfo ? liveInfo.title : vodInfo?.title}
            </h1>
          </div>

          <button
            type="button"
            onClick={handleStreamerClick}
            onKeyDown={(e) => handleKeyDown(e, handleStreamerClick)}
            className="streamer-name-btn"
          >
            {broadcaster?.displayName || "Unknown Streamer"}
          </button>

          <div className="player-info-meta">
            <button
              type="button"
              onClick={handleCategoryClick}
              onKeyDown={(e) => handleKeyDown(e, handleCategoryClick)}
              disabled={!game}
              className="category-tag-btn"
            >
              {game?.name || "No Category"}
            </button>

            {liveInfo && (
              <>
                <span className="status-chip live-viewer-count">
                  {liveInfo.viewerCount.toLocaleString()} viewers
                </span>
                <span className="status-chip">
                  <Uptime startedAt={liveInfo.startedAt} />
                </span>
              </>
            )}

            {vodInfo && (
              <>
                <span className="status-chip">
                  {(vodInfo.viewCount || 0).toLocaleString()} views
                </span>
                <span className="status-chip">
                  {new Date(vodInfo.createdAt).toLocaleDateString()}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayerInfo;
