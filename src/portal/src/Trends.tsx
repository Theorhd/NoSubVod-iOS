import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { VOD } from "../../shared/types";
import { VODCard } from "./components/VODCard";
import { TopBar } from "./components/TopBar";
import { navigateToPlayer } from "./utils/navigation";
import { VirtuosoGrid } from "react-virtuoso";
import "./styles/Common.scss";

function filterShortVods(vods: VOD[]): VOD[] {
  return vods.filter((v) => v.lengthSeconds >= 210);
}

export default function Trends() {
  const navigate = useNavigate();
  const [vods, setVods] = useState<VOD[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/trends")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch trending VODs");
        return res.json();
      })
      .then((data: VOD[]) => {
        setVods(filterShortVods(data));
        setIsInitialLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setIsInitialLoading(false);
      });
  }, []);

  return (
    <>
      <TopBar mode="back" title="Trending VODs" />

      <div className="container">
        {isInitialLoading && (
          <div className="status-line">Loading trending VODs...</div>
        )}
        {error && <div className="error-text">{error}</div>}

        {!isInitialLoading && !error && vods.length === 0 && (
          <div className="empty-state">No trends available right now.</div>
        )}

        {!isInitialLoading && !error && vods.length > 0 && (
          <VirtuosoGrid
            useWindowScroll
            data={vods}
            listClassName="vod-grid"
            itemContent={(index, vod) => (
              <VODCard
                key={vod.id}
                vod={vod}
                onWatch={(id) =>
                  navigateToPlayer(navigate, {
                    vodId: id,
                  })
                }
                showOwner={true}
              />
            )}
          />
        )}
      </div>
    </>
  );
}
