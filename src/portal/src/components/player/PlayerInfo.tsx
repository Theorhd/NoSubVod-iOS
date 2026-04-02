import React from 'react';
import { Download as DownloadIcon } from 'lucide-react';
import { VOD, LiveStream } from '../../../../shared/types';
import DownloadMenu from '../DownloadMenu';

interface PlayerInfoProps {
  vodInfo: VOD | null;
  liveInfo: LiveStream | null;
  duration: number;
  showDownloadMenu: boolean;
  onDownloadMenuToggle: (show: boolean) => void;
}

const Uptime: React.FC<{ startedAt: string }> = ({ startedAt }) => {
  const [uptime, setUptime] = React.useState('');

  React.useEffect(() => {
    const update = () => {
      const diff = Date.now() - new Date(startedAt).getTime();
      if (diff < 0) return setUptime('');
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

const PlayerInfo: React.FC<PlayerInfoProps> = ({
  vodInfo,
  liveInfo,
  duration,
  showDownloadMenu,
  onDownloadMenuToggle,
}) => {
  if (!vodInfo && !liveInfo) return null;

  return (
    <div style={{ padding: '20px', backgroundColor: '#07080f', color: '#efeff1', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '20px' }}>
        <img
          src={
            liveInfo ? liveInfo.broadcaster?.profileImageURL : vodInfo?.owner?.profileImageURL || ''
          }
          alt="Profile"
          style={{
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            objectFit: 'cover',
            border: '2px solid #3a3a3d',
          }}
        />

        <div style={{ flex: 1 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <h1 style={{ margin: '0 0 8px 0', fontSize: '1.4rem', lineHeight: '1.3' }}>
              {liveInfo ? liveInfo.title : vodInfo?.title}
            </h1>

            {vodInfo && (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="action-btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    background: '#9146ff',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                  }}
                  onClick={() => onDownloadMenuToggle(!showDownloadMenu)}
                >
                  <DownloadIcon size={18} />
                  Download
                </button>
                {showDownloadMenu && vodInfo && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      right: 0,
                      marginBottom: '8px',
                      zIndex: 10,
                    }}
                  >
                    <DownloadMenu
                      vodId={vodInfo.id}
                      title={vodInfo.title}
                      duration={duration}
                      onClose={() => onDownloadMenuToggle(false)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            style={{
              fontWeight: 'bold',
              fontSize: '1.1rem',
              marginBottom: '10px',
              color: '#bf94ff',
            }}
          >
            {liveInfo
              ? liveInfo.broadcaster?.displayName
              : vodInfo?.owner?.displayName || 'Unknown Streamer'}
          </div>

          <div
            style={{
              color: '#adadb8',
              fontSize: '0.95rem',
              display: 'flex',
              gap: '20px',
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                backgroundColor: '#18181b',
                padding: '4px 8px',
                borderRadius: '6px',
                fontWeight: 'bold',
              }}
            >
              {liveInfo ? liveInfo.game?.name : vodInfo?.game?.name || 'No Category'}
            </span>

            {liveInfo && (
              <>
                <span
                  style={{
                    color: '#eb0400',
                    fontWeight: 'bold',
                    backgroundColor: '#18181b',
                    padding: '4px 8px',
                    borderRadius: '6px',
                  }}
                >
                  {liveInfo.viewerCount.toLocaleString()} viewers
                </span>
                <span
                  style={{
                    backgroundColor: '#18181b',
                    padding: '4px 8px',
                    borderRadius: '6px',
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
                    backgroundColor: '#18181b',
                    padding: '4px 8px',
                    borderRadius: '6px',
                  }}
                >
                  {(vodInfo.viewCount || 0).toLocaleString()} views
                </span>
                <span
                  style={{
                    backgroundColor: '#18181b',
                    padding: '4px 8px',
                    borderRadius: '6px',
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
