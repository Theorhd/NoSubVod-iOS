import React from "react";
import { useNavigate } from "react-router-dom";
import { VOD, LiveStream } from "../../../../shared/types";

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
    <div
      style={{
        padding: "20px",
        backgroundColor: "#07080f",
        color: "#efeff1",
        flex: 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "20px" }}>
        <button
          type="button"
          onClick={handleStreamerClick}
          onKeyDown={(e) => handleKeyDown(e, handleStreamerClick)}
          aria-label={`Go to ${broadcaster?.displayName || "streamer"}'s channel`}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            borderRadius: "50%",
          }}
        >
          <img
            src={broadcaster?.profileImageURL || ""}
            alt={broadcaster?.displayName || "Profile"}
            style={{
              width: "72px",
              height: "72px",
              borderRadius: "50%",
              objectFit: "cover",
              border: "2px solid #3a3a3d",
            }}
          />
        </button>

        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <h1
              style={{
                margin: "0 0 8px 0",
                fontSize: "1.4rem",
                lineHeight: "1.3",
              }}
            >
              {liveInfo ? liveInfo.title : vodInfo?.title}
            </h1>
          </div>

          <button
            type="button"
            onClick={handleStreamerClick}
            onKeyDown={(e) => handleKeyDown(e, handleStreamerClick)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontWeight: "bold",
              fontSize: "1.1rem",
              marginBottom: "10px",
              color: "#bf94ff",
              cursor: "pointer",
              textAlign: "left",
              display: "block",
            }}
          >
            {broadcaster?.displayName || "Unknown Streamer"}
          </button>

          <div
            style={{
              color: "#adadb8",
              fontSize: "0.95rem",
              display: "flex",
              gap: "20px",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <button
              type="button"
              onClick={handleCategoryClick}
              onKeyDown={(e) => handleKeyDown(e, handleCategoryClick)}
              disabled={!game}
              style={{
                backgroundColor: "#18181b",
                padding: "4px 8px",
                borderRadius: "6px",
                fontWeight: "bold",
                cursor: game ? "pointer" : "default",
                border: "none",
                color: "#adadb8",
                fontSize: "0.95rem",
              }}
            >
              {game?.name || "No Category"}
            </button>

            {liveInfo && (
              <>
                <span
                  style={{
                    color: "#eb0400",
                    fontWeight: "bold",
                    backgroundColor: "#18181b",
                    padding: "4px 8px",
                    borderRadius: "6px",
                  }}
                >
                  {liveInfo.viewerCount.toLocaleString()} viewers
                </span>
                <span
                  style={{
                    backgroundColor: "#18181b",
                    padding: "4px 8px",
                    borderRadius: "6px",
                  }}
                >
                  <Uptime startedAt={liveInfo.startedAt} />
                </span>
              </>
            )}

            {vodInfo && (
              <>
                <span
                  style={{
                    backgroundColor: "#18181b",
                    padding: "4px 8px",
                    borderRadius: "6px",
                  }}
                >
                  {(vodInfo.viewCount || 0).toLocaleString()} views
                </span>
                <span
                  style={{
                    backgroundColor: "#18181b",
                    padding: "4px 8px",
                    borderRadius: "6px",
                  }}
                >
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
