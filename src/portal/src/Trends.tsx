import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { VOD } from '../../shared/types';
import { useInfiniteScroll } from './hooks/useInfiniteScroll';
import { VODCard } from './components/VODCard';
import { TopBar } from './components/TopBar';

const PAGE_SIZE = 24;

function filterShortVods(vods: VOD[]): VOD[] {
  return vods.filter((v) => v.lengthSeconds >= 210);
}

export default function Trends() {
  const navigate = useNavigate();
  const [vods, setVods] = useState<VOD[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');

  // ── Pagination state ──
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [allVods, setAllVods] = useState<VOD[]>([]);

  useEffect(() => {
    fetch('/api/trends')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch trending VODs');
        return res.json();
      })
      .then((data: VOD[]) => {
        const filtered = filterShortVods(data);
        setAllVods(filtered);
        setVods(filtered.slice(0, PAGE_SIZE));
        setIsInitialLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setIsInitialLoading(false);
      });
  }, []);

  const loadMore = useCallback(() => {
    if (isLoadingMore || visibleCount >= allVods.length) return;
    setIsLoadingMore(true);

    // Slight artificial delay to allow UI to render loading state gracefully
    setTimeout(() => {
      const nextCount = visibleCount + PAGE_SIZE;
      setVods(allVods.slice(0, nextCount));
      setVisibleCount(nextCount);
      setIsLoadingMore(false);
    }, 150);
  }, [allVods, isLoadingMore, visibleCount]);

  const { lastElementRef } = useInfiniteScroll({
    isLoading: isLoadingMore || isInitialLoading,
    hasMore: visibleCount < allVods.length,
    onLoadMore: loadMore,
  });

  return (
    <>
      <TopBar mode="back" title="Trending VODs" />

      <div className="container">
        {isInitialLoading && <div className="status-line">Loading trending VODs...</div>}
        {error && <div className="error-text">{error}</div>}

        {!isInitialLoading && !error && vods.length === 0 && (
          <div className="empty-state">No trends available right now.</div>
        )}

        {!isInitialLoading && !error && vods.length > 0 && (
          <div className="vod-grid">
            {vods.map((vod) => (
              <VODCard
                key={vod.id}
                vod={vod}
                onWatch={(id) => navigate(`/player?vod=${id}`)}
                showOwner={true}
              />
            ))}
          </div>
        )}

        <div ref={lastElementRef} style={{ height: '20px', width: '100%' }} aria-hidden="true" />
        {isLoadingMore && <div className="status-line">Loading more...</div>}
      </div>
    </>
  );
}
