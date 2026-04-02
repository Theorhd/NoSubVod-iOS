import React from 'react';

interface PlayerOverlayControlsProps {
  isMobileLayout: boolean;
  isMuted: boolean;
  volume: number;
  isFullscreen: boolean;
  toggleMute: () => void;
  toggleFullscreen: () => void;
  handleVolumeChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  revealControls: () => void;
}

export const PlayerOverlayControls: React.FC<PlayerOverlayControlsProps> = ({
  isMobileLayout,
  isMuted,
  volume,
  isFullscreen,
  toggleMute,
  toggleFullscreen,
  handleVolumeChange,
  revealControls,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: isMobileLayout ? '8px' : '14px',
        transform: 'translateX(-50%)',
        width: isMobileLayout ? 'calc(100% - 16px)' : 'min(620px, calc(100% - 28px))',
        background: 'linear-gradient(180deg, rgba(16, 18, 28, 0.84) 0%, rgba(9, 10, 16, 0.9) 100%)',
        border: '1px solid rgba(150, 162, 220, 0.28)',
        borderRadius: '10px',
        padding: '8px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexWrap: isMobileLayout ? 'wrap' : 'nowrap',
        backdropFilter: 'blur(6px)',
      }}
    >
      <button
        type="button"
        onClick={() => {
          toggleMute();
          revealControls();
        }}
        style={{
          border: '1px solid #36466f',
          background: '#1f2a46',
          color: '#eff3ff',
          borderRadius: '7px',
          padding: '6px 10px',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 600,
        }}
        aria-label={isMuted ? 'Activer le son' : 'Couper le son'}
      >
        {isMuted || volume <= 0 ? 'Son coupe' : 'Son actif'}
      </button>

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={isMuted ? 0 : volume}
        onChange={(event) => {
          handleVolumeChange(event);
          revealControls();
        }}
        aria-label="Volume"
        style={{
          flex: isMobileLayout ? '1 1 100%' : 1,
          accentColor: '#8ca6ff',
          cursor: 'pointer',
          order: isMobileLayout ? 3 : 0,
        }}
      />

      <span style={{ color: '#c9d2f3', fontSize: '12px', minWidth: '38px', textAlign: 'right' }}>
        {Math.round((isMuted ? 0 : volume) * 100)}%
      </span>

      <button
        type="button"
        onClick={() => {
          toggleFullscreen();
          revealControls();
        }}
        style={{
          border: '1px solid #36466f',
          background: '#1f2a46',
          color: '#eff3ff',
          borderRadius: '7px',
          padding: '6px 10px',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 600,
        }}
        aria-label={isFullscreen ? 'Quitter le plein ecran' : 'Activer le plein ecran'}
      >
        {isFullscreen ? 'Quitter plein ecran' : 'Plein ecran'}
      </button>
    </div>
  );
};
