import React from 'react';
import { LiveStream } from '../../../shared/types';
import { formatViewers, formatUptime } from '../../../shared/utils/formatters';
import { Users, Clock, Play } from 'lucide-react';

type StreamCardProps = {
  stream: LiveStream;
  onWatch: (login: string) => void;
  onCategoryClick?: (categoryName: string) => void;
  onChannelClick?: (login: string) => void;
  showBroadcaster?: boolean;
};

export const StreamCard = React.memo<StreamCardProps>(
  ({ stream, onWatch, onCategoryClick, onChannelClick, showBroadcaster = true }) => {
    return (
      <div className="stream-card glass-hover">
        <div className="vod-thumb-wrap">
          <img
            src={
              stream.previewImageURL?.replace('-{width}x{height}', '') ||
              'https://static-cdn.jtvnw.net/ttv-static/404_preview-320x180.jpg'
            }
            alt={stream.title}
            className="vod-thumb"
            loading="lazy"
          />
          <div className="live-badge pulse">LIVE</div>

          <div
            className="vod-play-overlay"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255, 107, 135, 0.15)',
              opacity: 0,
              transition: 'opacity 0.3s ease',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'var(--danger)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                boxShadow: '0 0 20px rgba(255, 107, 135, 0.5)',
              }}
            >
              <Play size={24} fill="currentColor" />
            </div>
          </div>

          <button
            className="stretched-link"
            aria-label={`Regarder le live de ${stream.broadcaster.displayName}`}
            onClick={() => onWatch(stream.broadcaster.login)}
            style={{ background: 'none', border: 'none', padding: 0 }}
          />
        </div>

        <div className="vod-body" style={{ position: 'relative', zIndex: 3 }}>
          {showBroadcaster && stream.broadcaster && (
            <div className="vod-meta" style={{ marginBottom: '8px', color: 'var(--text)' }}>
              {stream.broadcaster.profileImageURL && (
                <img
                  src={stream.broadcaster.profileImageURL}
                  alt={stream.broadcaster.displayName}
                  style={{ width: '20px', height: '20px', borderRadius: '50%' }}
                />
              )}
              <button
                type="button"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  font: 'inherit',
                  color: 'inherit',
                  fontWeight: 600,
                  cursor: onChannelClick ? 'pointer' : 'default',
                  textDecoration: 'none',
                }}
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
            className="vod-title"
            title={stream.title}
            style={{ position: 'relative', zIndex: 3 }}
          >
            {stream.title}
          </h3>

          <div className="vod-meta" style={{ justifyContent: 'space-between', marginTop: '8px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              {stream.game?.name && onCategoryClick ? (
                <button
                  type="button"
                  className="secondary-btn"
                  style={{
                    position: 'relative',
                    zIndex: 4,
                    fontSize: '0.7rem',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    border: '1px solid var(--primary-glow)',
                    color: 'var(--primary)',
                    fontWeight: 700,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCategoryClick(stream.game!.name);
                  }}
                >
                  {stream.game.name}
                </button>
              ) : (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {stream.game?.name || 'No category'}
                </span>
              )}

              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: 'var(--success)',
                  fontWeight: 700,
                }}
              >
                <Users size={12} />
                {formatViewers(stream.viewerCount)}
              </span>
            </div>
          </div>

          {stream.startedAt && (
            <div
              style={{
                marginTop: '8px',
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <Clock size={12} />
              Uptime: {formatUptime(stream.startedAt)}
            </div>
          )}
        </div>

        <style>{`
        .stream-card:hover .vod-play-overlay { opacity: 1 !important; }
        @keyframes pulse-live {
          0% { box-shadow: 0 0 0 0 rgba(255, 107, 135, 0.7); }
          70% { box-shadow: 0 0 0 10px rgba(255, 107, 135, 0); }
          100% { box-shadow: 0 0 0 0 rgba(255, 107, 135, 0); }
        }
        .pulse {
          animation: pulse-live 2s infinite;
        }
      `}</style>
      </div>
    );
  }
);

StreamCard.displayName = 'StreamCard';
