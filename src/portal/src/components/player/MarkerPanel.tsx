import React from 'react';
import { VideoMarker } from '../../../../shared/types';
import { formatSafeClock as formatClock } from '../../../../shared/utils/formatters';
import { Play, Tag, X } from 'lucide-react';

interface MarkerPanelProps {
  markers: VideoMarker[];
  onSeek: (time: number) => void;
  onClose: () => void;
  currentTime?: number;
}

const MarkerPanel: React.FC<MarkerPanelProps> = ({ markers, onSeek, onClose, currentTime = 0 }) => {
  if (markers.length === 0) return null;

  return (
    <div
      className="glass"
      style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        width: '320px',
        maxHeight: 'calc(100% - 40px)',
        borderRadius: 'var(--radius-lg)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-lg)',
        border: '1px solid var(--border)',
        animation: 'page-fade-in 0.3s ease-out',
      }}
    >
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(0,0,0,0.3)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#fff' }}>Chapitres</h3>
        <button
          onClick={onClose}
          className="secondary-btn"
          style={{
            width: '32px',
            height: '32px',
            padding: 0,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="Fermer"
        >
          <X size={18} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }} className="custom-marker-list">
        {markers.map((marker, index) => {
          const nextTime = markers[index + 1]?.displayTime || Infinity;
          const isActive = currentTime >= marker.displayTime && currentTime < nextTime;

          return (
            <button
              key={marker.id}
              type="button"
              onClick={() => onSeek(marker.displayTime)}
              className="glass-hover"
              style={{
                display: 'flex',
                width: '100%',
                textAlign: 'left',
                background: isActive ? 'rgba(143, 87, 255, 0.2)' : 'rgba(255,255,255,0.03)',
                border: '1px solid',
                borderColor: isActive ? 'var(--primary)' : 'transparent',
                borderRadius: 'var(--radius-md)',
                padding: '10px',
                marginBottom: '8px',
                cursor: 'pointer',
                gap: '12px',
                alignItems: 'center',
                transition: 'all 0.2s var(--transition-fast)',
                color: 'inherit',
              }}
            >
              <div
                style={{
                  width: '44px',
                  height: '60px',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  background: '#000',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                {marker.url ? (
                  <img
                    src={marker.url}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <Tag size={18} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                )}
              </div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    color: isActive ? '#fff' : 'var(--text)',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginBottom: '4px',
                  }}
                >
                  {marker.description}
                </div>
                <div
                  style={{
                    color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                    fontSize: '0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontWeight: 600,
                  }}
                >
                  <Play size={12} fill="currentColor" />
                  {formatClock(marker.displayTime)}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <style>{`
        .custom-marker-list::-webkit-scrollbar {
          width: 4px;
        }
        .custom-marker-list::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-marker-list::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
};

export default MarkerPanel;
