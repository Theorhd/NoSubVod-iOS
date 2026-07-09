import React from "react";
import { useNavigate } from "react-router-dom";
import { UserInfo } from "../../../../shared/types";
import { Search } from "lucide-react";
import styles from "./ChannelSearchCard.module.scss";

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
      <div className={`card glass ${styles["extracted-style-1"]}`}>
        <form onSubmit={handleChannelSearch}>
          <div className={styles["extracted-style-2"]}>
            <div className={styles["extracted-style-3"]}>
              <Search size={18} className={styles["extracted-style-4"]} />
              <input
                type="text"
                id="channelSearch"
                placeholder="Search channels, streams or VODs..."
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                autoComplete="off"
                className={styles["extracted-style-5"]}
              />
            </div>
            <button
              type="submit"
              className={`action-btn ${styles["extracted-style-6"]}`}
              disabled={isSearchingChannels}
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
          <div className={styles["extracted-style-7"]}>
            {searchResults.map((user) => (
              <button
                key={user.id}
                className={`glass-hover ${styles["extracted-style-8"]}`}
                onClick={() =>
                  navigate(`/channel?user=${encodeURIComponent(user.login)}`)
                }
                type="button"
              >
                <img
                  src={user.profileImageURL}
                  alt={user.displayName}
                  className={styles["extracted-style-9"]}
                />
                <div className={styles["extracted-style-10"]}>
                  {user.displayName}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },
);

ChannelSearchCard.displayName = "ChannelSearchCard";
export default ChannelSearchCard;
