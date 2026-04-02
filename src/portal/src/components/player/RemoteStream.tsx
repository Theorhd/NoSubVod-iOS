import React from 'react';

interface RemoteStreamProps {
  useNativeMobilePlayer: boolean;
  isMuted: boolean;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  viewerSurfaceRef: React.RefObject<HTMLButtonElement | null>;
  revealControls: () => void;
  onMouseMove: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseUp: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onWheel: (event: React.WheelEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export const RemoteStream: React.FC<RemoteStreamProps> = ({
  useNativeMobilePlayer,
  isMuted,
  remoteVideoRef,
  viewerSurfaceRef,
  revealControls,
  onMouseMove,
  onMouseDown,
  onMouseUp,
  onWheel,
  onKeyDown,
  onKeyUp,
}) => {
  if (useNativeMobilePlayer) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000',
        }}
      >
        <video
          ref={remoteVideoRef}
          className="screen-share-video"
          autoPlay
          playsInline
          muted={isMuted}
          controls
          controlsList="nodownload noplaybackrate"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            backgroundColor: '#000',
          }}
        >
          <track kind="captions" />
        </video>
      </div>
    );
  }

  return (
    <button
      ref={viewerSurfaceRef}
      type="button"
      className="screen-share-remote-surface"
      style={{
        touchAction: 'none',
        border: 'none',
        padding: 0,
        background: 'transparent',
        width: '100%',
        height: '100%',
        display: 'block',
      }}
      aria-label="Interactive remote stream"
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onWheelCapture={onWheel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onTouchStart={revealControls}
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => viewerSurfaceRef.current?.focus()}
    >
      <video
        ref={remoteVideoRef}
        className="screen-share-video"
        autoPlay
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          backgroundColor: '#000',
        }}
      >
        <track kind="captions" />
      </video>
    </button>
  );
};
