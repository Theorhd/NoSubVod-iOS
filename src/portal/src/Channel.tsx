import React from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { StreamCard } from './components/StreamCard';
import { VODCard } from './components/VODCard';
import { TopBar } from './components/TopBar';
import { useChannelData } from './hooks/useChannelData';

export default function Channel() {
  const [searchParams] = useSearchParams();
  const user = searchParams.get('user');
  const category = searchParams.get('category');
  const categoryId = searchParams.get('categoryId');
  const navigate = useNavigate();
  const {
    title,
    isUserMode,
    isCategoryMode,
    vods,
    liveStream,
    history,
    loading,
    error,
    catLiveStreams,
    catLiveHasMore,
    catLiveLoading,
    catVodHasMore,
    catVodLoading,
    loadMoreCatVods,
    loadMoreCatLive,
    addToWatchlist,
  } = useChannelData({ user, category, categoryId });

  return (
    <>
      <TopBar mode="back" title={title} />

      <div className="container">
        {loading && <div className="status-line">Loading...</div>}
        {error && <div className="error-text">{error}</div>}

        {!loading && !error && vods.length === 0 && catLiveStreams.length === 0 && (
          <div className="empty-state">No content found.</div>
        )}

        {/* User live (user-channel mode) */}
        {!loading && !error && liveStream && isUserMode && (
          <div className="block-section" style={{ marginTop: 0 }}>
            <h2>Live</h2>
            <div className="vod-grid">
              <StreamCard
                key={liveStream.id}
                stream={liveStream}
                onWatch={(login) => navigate(`/player?live=${encodeURIComponent(login)}`)}
              />
            </div>
          </div>
        )}

        {/* Category live streams */}
        {!loading && !error && isCategoryMode && catLiveStreams.length > 0 && (
          <div className="block-section" style={{ marginTop: 0 }}>
            <div className="section-header-row">
              <h2>Lives en ce moment</h2>
              <span className="section-count">
                {catLiveStreams.length} stream{catLiveStreams.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="vod-grid">
              {catLiveStreams.map((stream) => (
                <StreamCard
                  key={stream.id}
                  stream={stream}
                  onWatch={(login) => navigate(`/player?live=${encodeURIComponent(login)}`)}
                />
              ))}
            </div>
            {catLiveHasMore && (
              <div className="load-more-row">
                <button
                  type="button"
                  className="load-more-btn"
                  onClick={() => void loadMoreCatLive()}
                  disabled={catLiveLoading}
                >
                  {catLiveLoading ? 'Chargement...' : 'Voir plus de lives'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* VODs */}
        {!loading && !error && vods.length > 0 && (
          <div
            className="block-section"
            style={{ marginTop: catLiveStreams.length > 0 || liveStream ? '16px' : '0' }}
          >
            <div className="section-header-row">
              <h2>VODs</h2>
              <span className="section-count">
                {vods.length} VOD{vods.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="vod-grid">
              {vods.map((vod) => {
                const hist = history[vod.id];
                return (
                  <VODCard
                    key={vod.id}
                    vod={vod}
                    onWatch={(id) => navigate(`/player?vod=${id}`)}
                    historyEntry={hist}
                    onAddToWatchlist={(e, vodItem) => {
                      e.stopPropagation();
                      void addToWatchlist(vodItem);
                    }}
                  />
                );
              })}
            </div>
            {catVodHasMore && (
              <div className="load-more-row">
                <button
                  type="button"
                  className="load-more-btn"
                  onClick={() => void loadMoreCatVods()}
                  disabled={catVodLoading}
                >
                  {catVodLoading ? 'Chargement...' : 'Voir plus de VODs'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
