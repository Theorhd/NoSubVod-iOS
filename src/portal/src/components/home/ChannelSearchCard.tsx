import React from "react";
import { useNavigate } from "react-router-dom";
import { UserInfo } from "../../../../shared/types";
import { Search } from "lucide-react";
import Glass from "../Glass";

interface ChannelSearchCardProps {
  readonly channelSearch: string;
  readonly setChannelSearch: (value: string) => void;
  readonly isSearchingChannels: boolean;
  readonly searchResults: UserInfo[];
  readonly handleChannelSearch: (e: React.SyntheticEvent) => Promise<void>;
}

const ChannelSearchCard = React.memo(
  ({
    channelSearch,
    setChannelSearch,
    isSearchingChannels,
    searchResults,
    handleChannelSearch,
  }: ChannelSearchCardProps) => {
    const navigate = useNavigate();

    return (
      <Glass
        className="card"
        cornerRadius={14}
        style={{ marginBottom: "24px" }}
      >
        <form onSubmit={handleChannelSearch}>
          <div style={{ display: "flex", gap: "12px" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search
                size={18}
                style={{
                  position: "absolute",
                  left: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-muted)",
                }}
              />
              <input
                type="text"
                id="channelSearch"
                style={{ paddingLeft: "44px", width: "100%" }}
                placeholder="Search channels, streams or VODs..."
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                autoComplete="off"
              />
            </div>
            <button
              type="submit"
              className="action-btn"
              disabled={isSearchingChannels}
              style={{ minWidth: "100px" }}
            >
              {isSearchingChannels ? (
                <div className="spinning">●</div>
              ) : (
                "Search"
              )}
            </button>
          </div>
        </form>

        {searchResults.length > 0 && (
          <div
            style={{
              marginTop: "20px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "12px",
            }}
          >
            {searchResults.map((user) => (
              <Glass
                key={user.id}
                cornerRadius={12}
                elasticity={0.15}
                onClick={() =>
                  navigate(`/channel?user=${encodeURIComponent(user.login)}`)
                }
              >
                <div
                  style={{
                    border: "none",
                    background: "transparent",
                    textAlign: "left",
                    color: "inherit",
                    padding: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    cursor: "pointer",
                    width: "100%",
                  }}
                >
                  <img
                    src={user.profileImageURL}
                    alt={user.displayName}
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "50%",
                    }}
                  />
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                    {user.displayName}
                  </div>
                </div>
              </Glass>
            ))}
          </div>
        )}
      </Glass>
    );
  },
);

ChannelSearchCard.displayName = "ChannelSearchCard";
export default ChannelSearchCard;
