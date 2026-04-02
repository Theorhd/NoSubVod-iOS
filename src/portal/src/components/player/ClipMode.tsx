import React from 'react';
import { VOD } from '../../../../shared/types';
import { formatSafeClock as formatClock } from '../../../../shared/utils/formatters';

interface ClipModeProps {
  duration: number;
  clipStart: number | null;
  clipEnd: number | null;
  vodId: string;
  vodInfo: VOD | null;
  onSetStart: () => void;
  onSetEnd: () => void;
  onDownloadStart: () => void;
}

const ClipMode: React.FC<ClipModeProps> = ({
  duration,
  clipStart,
  clipEnd,
  vodId,
  vodInfo,
  onSetStart,
  onSetEnd,
  onDownloadStart,
}) => {
  const handleDownload = async () => {
    try {
      const res = await fetch('/api/download/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vodId,
          title: vodInfo?.title || `Clip ${vodId}`,
          quality: 'best',
          startTime: clipStart || 0,
          endTime: clipEnd ?? duration,
          duration,
        }),
      });
      if (res.ok) {
        alert('Clip download started in background.');
        onDownloadStart();
      } else {
        throw new Error('Failed to start clip download');
      }
    } catch (e) {
      alert(`Error: ${e}`);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        margin: '12px 16px',
        background: 'rgba(0,0,0,0.35)',
        padding: '10px',
        borderRadius: '10px',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ color: '#4ade80', fontWeight: 'bold', fontSize: '0.9rem' }}>Clip Mode</span>
      <button
        type="button"
        onClick={onSetStart}
        className="action-btn"
        style={{ padding: '5px 10px', fontSize: '0.8rem' }}
      >
        Set Start
      </button>
      <span style={{ fontSize: '0.85rem', color: '#adadb8' }}>{formatClock(clipStart || 0)}</span>
      <button
        type="button"
        onClick={onSetEnd}
        className="action-btn"
        style={{ padding: '5px 10px', fontSize: '0.8rem' }}
      >
        Set End
      </button>
      <span style={{ fontSize: '0.85rem', color: '#adadb8' }}>
        {formatClock(clipEnd ?? duration)}
      </span>
      <button
        type="button"
        onClick={handleDownload}
        className="action-btn"
        style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: '0.8rem' }}
      >
        Download Selection
      </button>
    </div>
  );
};

export default ClipMode;
