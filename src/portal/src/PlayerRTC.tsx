import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useResponsive } from './hooks/useResponsive';
import { useScreenShareState } from '../../shared/hooks/useScreenShareState';
import type { RemoteControlPayload, ScreenShareSessionState } from '../../shared/types';
import { useWebRTCViewer } from './hooks/useWebRTCViewer';
import { usePlayerControls } from './hooks/usePlayerControls';

const RELAY_STORAGE_KEY = 'nsv_remote_relay_origin';

function getAuthQueryFromStorage(): string {
  const token =
    globalThis.sessionStorage.getItem('nsv_token') ||
    globalThis.localStorage.getItem('nsv_token');
  const deviceId = globalThis.localStorage.getItem('nsv_device_id');
  const params = new URLSearchParams();
  if (token) params.set('t', token);
  if (deviceId) params.set('d', deviceId);
  return params.toString();
}

function normalizeRelayOrigin(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withScheme).origin;
}

function formatStartedAt(startedAt: number | null): string {
  if (!startedAt) return 'Not started';
  const date = new Date(startedAt);
  return date.toLocaleString();
}

const pointerButtonFromMouseEvent = (button: number): 'left' | 'middle' | 'right' => {
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'left';
};

const normalizedPointerPosition = (
  event: React.MouseEvent<HTMLButtonElement>,
  surface: HTMLButtonElement | null
) => {
  if (!surface) {
    return { x: 0.5, y: 0.5 };
  }

  const rect = surface.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
  const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));

  return {
    x: Number.isFinite(x) ? x : 0.5,
    y: Number.isFinite(y) ? y : 0.5,
  };
};

type PlayerRTCViewProps = {
  isMobileLayout: boolean;
  useNativeMobilePlayer: boolean;
  statusLabel: string;
  rtcStatus: string;
  signalStatus: string;
  hasRemoteStream: boolean;
  controlsVisible: boolean;
  isFullscreen: boolean;
  volume: number;
  isMuted: boolean;
  streamError: string;
  state: {
    active: boolean;
    sessionId: string | null;
    sourceType: string | null;
    sourceLabel: string | null;
    startedAt: number | null;
    interactive: boolean;
    maxViewers: number;
    currentViewers: number;
    streamReady: boolean;
    streamMessage: string | null;
  };
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  viewerSurfaceRef: React.RefObject<HTMLButtonElement | null>;
  playerFrameRef: React.RefObject<HTMLDivElement | null>;
  handleBack: () => void;
  handleViewerMouseMove: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleViewerMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleViewerMouseUp: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleViewerWheel: (event: React.WheelEvent<HTMLButtonElement>) => void;
  handleViewerKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  handleViewerKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  revealControls: () => void;
  toggleMute: () => void;
  handleVolumeChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  toggleFullscreen: () => Promise<void>;
  sendRemoteControl: (payload: RemoteControlPayload) => void;
};

type PlayerRTCHeaderProps = Readonly<{
  isMobileLayout: boolean;
  statusLabel: string;
  rtcStatus: string;
  signalStatus: string;
  handleBack: () => void;
}>;

type PlayerRTCOverlayControlsProps = Readonly<{
  isMobileLayout: boolean;
  isMuted: boolean;
  volume: number;
  isFullscreen: boolean;
  toggleMute: () => void;
  revealControls: () => void;
  handleVolumeChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  toggleFullscreen: () => Promise<void>;
}>;

type PlayerRTCViewportProps = Readonly<
  Omit<
    PlayerRTCViewProps,
    'statusLabel' | 'rtcStatus' | 'signalStatus' | 'handleBack' | 'sendRemoteControl'
  >
>;

type PlayerRTCSidebarProps = Readonly<{
  isMobileLayout: boolean;
  statusLabel: string;
  signalStatus: string;
  rtcStatus: string;
  hasRemoteStream: boolean;
  sendRemoteControl: (payload: RemoteControlPayload) => void;
  state: PlayerRTCViewProps['state'];
}>;

function PlayerRTCTransportControls({
  hasRemoteStream,
  sendRemoteControl,
}: Readonly<{
  hasRemoteStream: boolean;
  sendRemoteControl: (payload: RemoteControlPayload) => void;
}>) {
  const buttonStyle: React.CSSProperties = {
    border: '1px solid #36466f',
    background: '#1f2a46',
    color: '#eff3ff',
    borderRadius: '7px',
    padding: '8px 10px',
    cursor: hasRemoteStream ? 'pointer' : 'not-allowed',
    fontSize: '12px',
    fontWeight: 700,
    minWidth: '72px',
    opacity: hasRemoteStream ? 1 : 0.5,
  };

  return (
    <div
      style={{
        border: '1px solid #2f3f66',
        borderRadius: '10px',
        padding: '10px',
        background: 'rgba(20, 28, 45, 0.5)',
      }}
    >
      <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '8px' }}>Contrôles</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <button
          type="button"
          style={buttonStyle}
          disabled={!hasRemoteStream}
          onClick={() => sendRemoteControl({ command: 'seek', value: -10 })}
        >
          ← 10s
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={!hasRemoteStream}
          onClick={() => sendRemoteControl({ command: 'seek', value: 10 })}
        >
          10s →
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={!hasRemoteStream}
          onClick={() => sendRemoteControl({ command: 'play' })}
        >
          Play
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={!hasRemoteStream}
          onClick={() => sendRemoteControl({ command: 'pause' })}
        >
          Pause
        </button>
      </div>
    </div>
  );
}

function PlayerRTCHeader({
  isMobileLayout,
  statusLabel,
  rtcStatus,
  signalStatus,
  handleBack,
}: PlayerRTCHeaderProps) {
  return (
    <div
      style={{
        backgroundColor: '#18181b',
        padding: isMobileLayout ? '10px 12px' : '10px 20px',
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid #3a3a3d',
        zIndex: 10,
        flexShrink: 0,
        gap: isMobileLayout ? '8px' : '10px',
      }}
    >
      <button
        onClick={handleBack}
        style={{
          color: '#efeff1',
          fontSize: '14px',
          fontWeight: 'bold',
          padding: '5px 10px',
          backgroundColor: '#3a3a3d',
          borderRadius: '4px',
          border: 'none',
          cursor: 'pointer',
        }}
        type="button"
      >
        Back
      </button>

      <h2
        style={{
          color: 'white',
          fontSize: '14px',
          margin: 0,
          flexGrow: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        Screen Share
      </h2>

      <span style={{ color: '#efeff1', fontSize: '12px' }}>
        {isMobileLayout
          ? `${statusLabel} · ${rtcStatus}`
          : `${statusLabel} · ${signalStatus} · ${rtcStatus}`}
      </span>
    </div>
  );
}

function PlayerRTCOverlayControls({
  isMobileLayout,
  isMuted,
  volume,
  isFullscreen,
  toggleMute,
  revealControls,
  handleVolumeChange,
  toggleFullscreen,
}: PlayerRTCOverlayControlsProps) {
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
          void toggleFullscreen();
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
}

function PlayerRTCViewport({
  isMobileLayout,
  useNativeMobilePlayer,
  hasRemoteStream,
  controlsVisible,
  isFullscreen,
  volume,
  isMuted,
  streamError,
  state,
  remoteVideoRef,
  viewerSurfaceRef,
  playerFrameRef,
  handleViewerMouseMove,
  handleViewerMouseDown,
  handleViewerMouseUp,
  handleViewerWheel,
  handleViewerKeyDown,
  handleViewerKeyUp,
  revealControls,
  toggleMute,
  handleVolumeChange,
  toggleFullscreen,
}: PlayerRTCViewportProps) {
  const remoteStreamNode = useNativeMobilePlayer ? (
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
  ) : (
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
      onMouseMove={handleViewerMouseMove}
      onMouseDown={handleViewerMouseDown}
      onMouseUp={handleViewerMouseUp}
      onWheelCapture={handleViewerWheel}
      onKeyDown={handleViewerKeyDown}
      onKeyUp={handleViewerKeyUp}
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

  return (
    <div
      ref={playerFrameRef}
      style={{
        flex: 1,
        minHeight: isMobileLayout ? '50vh' : undefined,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'stretch',
        backgroundColor: '#000',
        position: 'relative',
        overflow: 'hidden',
        cursor: isFullscreen && hasRemoteStream && !controlsVisible ? 'none' : 'default',
      }}
    >
      {hasRemoteStream ? (
        remoteStreamNode
      ) : (
        <div
          style={{
            color: '#efeff1',
            textAlign: 'center',
            padding: '24px',
          }}
        >
          <div style={{ fontSize: '18px', marginBottom: '8px' }}>Waiting for host stream...</div>
          <div style={{ color: '#a1a1aa', fontSize: '14px' }}>
            {state.streamMessage ||
              'When the host starts sharing, the WebRTC feed will appear here.'}
          </div>
        </div>
      )}

      {hasRemoteStream && controlsVisible && !useNativeMobilePlayer && (
        <PlayerRTCOverlayControls
          isMobileLayout={isMobileLayout}
          isMuted={isMuted}
          volume={volume}
          isFullscreen={isFullscreen}
          toggleMute={toggleMute}
          revealControls={revealControls}
          handleVolumeChange={handleVolumeChange}
          toggleFullscreen={toggleFullscreen}
        />
      )}

      {streamError && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0,0,0,0.6)',
            padding: '8px 12px',
            borderRadius: '6px',
            color: '#ff9c9c',
            fontSize: '13px',
          }}
        >
          {streamError}
        </div>
      )}
    </div>
  );
}

function PlayerRTCSidebar({
  isMobileLayout,
  statusLabel,
  signalStatus,
  rtcStatus,
  hasRemoteStream,
  sendRemoteControl,
  state,
}: PlayerRTCSidebarProps) {
  return (
    <div
      style={{
        width: isMobileLayout ? '100%' : '320px',
        backgroundColor: '#0e0e10',
        borderLeft: isMobileLayout ? 'none' : '1px solid #3a3a3d',
        borderTop: isMobileLayout ? '1px solid #3a3a3d' : 'none',
        padding: isMobileLayout ? '12px' : '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        flexShrink: 0,
        maxHeight: isMobileLayout ? '38vh' : 'none',
        overflowY: isMobileLayout ? 'auto' : 'visible',
      }}
    >
      <PlayerRTCTransportControls
        hasRemoteStream={hasRemoteStream}
        sendRemoteControl={sendRemoteControl}
      />

      <div>
        <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>Session</div>
        <div style={{ color: '#efeff1', fontSize: '14px', fontWeight: 'bold' }}>
          {state.sessionId || 'Not started'}
        </div>
      </div>

      <div>
        <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>Source</div>
        <div style={{ color: '#efeff1', fontSize: '14px', fontWeight: 'bold' }}>
          {state.sourceLabel || 'No source'} ({state.sourceType || 'n/a'})
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <div>
          <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>Status</div>
          <div style={{ color: '#efeff1', fontSize: '14px' }}>{statusLabel}</div>
        </div>
        <div>
          <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>Viewers</div>
          <div style={{ color: '#efeff1', fontSize: '14px' }}>
            {state.currentViewers}/{state.maxViewers}
          </div>
        </div>
        <div>
          <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>Signal</div>
          <div style={{ color: '#efeff1', fontSize: '14px' }}>{signalStatus}</div>
        </div>
        <div>
          <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>WebRTC</div>
          <div style={{ color: '#efeff1', fontSize: '14px' }}>{rtcStatus}</div>
        </div>
      </div>

      <div>
        <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>Started</div>
        <div style={{ color: '#efeff1', fontSize: '14px' }}>{formatStartedAt(state.startedAt)}</div>
      </div>

      <div style={{ color: '#a1a1aa', fontSize: '12px', marginTop: '8px' }}>
        {state.interactive
          ? 'Pointer/keyboard input forwarded to host.'
          : 'Remote control disabled by host.'}
      </div>
    </div>
  );
}

function renderPlayerRTCView(props: PlayerRTCViewProps) {
  const {
    isMobileLayout,
    useNativeMobilePlayer,
    statusLabel,
    rtcStatus,
    signalStatus,
    hasRemoteStream,
    controlsVisible,
    isFullscreen,
    volume,
    isMuted,
    streamError,
    state,
    remoteVideoRef,
    viewerSurfaceRef,
    playerFrameRef,
    handleBack,
    handleViewerMouseMove,
    handleViewerMouseDown,
    handleViewerMouseUp,
    handleViewerWheel,
    handleViewerKeyDown,
    handleViewerKeyUp,
    revealControls,
    toggleMute,
    handleVolumeChange,
    toggleFullscreen,
    sendRemoteControl,
  } = props;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100dvh',
        backgroundColor: '#07080f',
        overflow: 'hidden',
      }}
    >
      <PlayerRTCHeader
        isMobileLayout={isMobileLayout}
        statusLabel={statusLabel}
        rtcStatus={rtcStatus}
        signalStatus={signalStatus}
        handleBack={handleBack}
      />

      <div
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
          flexDirection: isMobileLayout ? 'column' : 'row',
        }}
      >
        <PlayerRTCViewport
          isMobileLayout={isMobileLayout}
          useNativeMobilePlayer={useNativeMobilePlayer}
          hasRemoteStream={hasRemoteStream}
          controlsVisible={controlsVisible}
          isFullscreen={isFullscreen}
          volume={volume}
          isMuted={isMuted}
          streamError={streamError}
          state={state}
          remoteVideoRef={remoteVideoRef}
          viewerSurfaceRef={viewerSurfaceRef}
          playerFrameRef={playerFrameRef}
          handleViewerMouseMove={handleViewerMouseMove}
          handleViewerMouseDown={handleViewerMouseDown}
          handleViewerMouseUp={handleViewerMouseUp}
          handleViewerWheel={handleViewerWheel}
          handleViewerKeyDown={handleViewerKeyDown}
          handleViewerKeyUp={handleViewerKeyUp}
          revealControls={revealControls}
          toggleMute={toggleMute}
          handleVolumeChange={handleVolumeChange}
          toggleFullscreen={toggleFullscreen}
        />

        <PlayerRTCSidebar
          isMobileLayout={isMobileLayout}
          statusLabel={statusLabel}
          signalStatus={signalStatus}
          rtcStatus={rtcStatus}
          hasRemoteStream={hasRemoteStream}
          sendRemoteControl={sendRemoteControl}
          state={state}
        />
      </div>
    </div>
  );
}

export default function PlayerRTC() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionIdParam = searchParams.get('sessionId');
  const relayParam = searchParams.get('relay') || '';

  const relayOrigin = useMemo(() => {
    const candidate = relayParam || globalThis.localStorage.getItem(RELAY_STORAGE_KEY) || '';
    try {
      const normalized = normalizeRelayOrigin(candidate);
      if (normalized) {
        globalThis.localStorage.setItem(RELAY_STORAGE_KEY, normalized);
      }
      return normalized || null;
    } catch {
      return null;
    }
  }, [relayParam]);

  const { isMobileLayout, isTouchDevice } = useResponsive();
  const fetchScreenShareState = useCallback(async () => {
    const authQuery = getAuthQueryFromStorage();
    const statePath = '/api/screenshare/state';
    const endpointBase = relayOrigin ? `${relayOrigin}${statePath}` : statePath;
    const endpoint = authQuery ? `${endpointBase}?${authQuery}` : endpointBase;

    const response = await fetch(endpoint);
    if (!response.ok) throw new Error('Failed to fetch state');
    return (await response.json()) as ScreenShareSessionState;
  }, [relayOrigin]);
  const { state, setState } = useScreenShareState(fetchScreenShareState, 3000);

  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const viewerSurfaceRef = useRef<HTMLButtonElement | null>(null);
  const playerFrameRef = useRef<HTMLDivElement | null>(null);
  const lastPointerMoveRef = useRef(0);

  const {
    signalStatus,
    rtcStatus,
    hasRemoteStream,
    streamError,
    sendRemoteInput,
    sendRemoteControl,
  } = useWebRTCViewer(sessionIdParam, state, setState, remoteVideoRef, relayOrigin);

  const {
    isFullscreen,
    volume,
    isMuted,
    controlsVisible,
    toggleFullscreen,
    toggleMute,
    handleVolumeChange,
    revealControls,
  } = usePlayerControls(hasRemoteStream, remoteVideoRef, playerFrameRef);

  useEffect(() => {
    if (hasRemoteStream && viewerSurfaceRef.current) {
      viewerSurfaceRef.current.focus();
    }
  }, [hasRemoteStream]);

  const statusLabel = useMemo(() => {
    if (!state.active) return 'Offline';
    return state.streamReady ? 'Live' : 'Preparing';
  }, [state.active, state.streamReady]);

  const useNativeMobilePlayer = isMobileLayout || isTouchDevice;

  const handleViewerMouseMove = (event: React.MouseEvent<HTMLButtonElement>) => {
    revealControls();
    // eslint-disable-next-line react-hooks/purity
    const now = performance.now();
    if (now - lastPointerMoveRef.current < 8) {
      return;
    }
    lastPointerMoveRef.current = now;

    const pos = normalizedPointerPosition(event, viewerSurfaceRef.current);
    sendRemoteInput({
      kind: 'pointer',
      action: 'move',
      x: pos.x,
      y: pos.y,
    });
  };

  const handleViewerMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    revealControls();
    const pos = normalizedPointerPosition(event, viewerSurfaceRef.current);
    sendRemoteInput({
      kind: 'pointer',
      action: 'down',
      button: pointerButtonFromMouseEvent(event.button),
      x: pos.x,
      y: pos.y,
    });
  };

  const handleViewerMouseUp = (event: React.MouseEvent<HTMLButtonElement>) => {
    revealControls();
    const pos = normalizedPointerPosition(event, viewerSurfaceRef.current);
    sendRemoteInput({
      kind: 'pointer',
      action: 'up',
      button: pointerButtonFromMouseEvent(event.button),
      x: pos.x,
      y: pos.y,
    });
  };

  const handleViewerWheel = (event: React.WheelEvent<HTMLButtonElement>) => {
    revealControls();
    const surface = viewerSurfaceRef.current;
    const rect = surface?.getBoundingClientRect();
    const x = rect
      ? Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))
      : 0.5;
    const y = rect
      ? Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)))
      : 0.5;
    sendRemoteInput({
      kind: 'pointer',
      action: 'wheel',
      x,
      y,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    });
  };

  const handleViewerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    revealControls();
    if (event.repeat) {
      return;
    }
    sendRemoteInput({
      kind: 'keyboard',
      action: 'down',
      key: event.key,
    });
  };

  const handleViewerKeyUp = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    revealControls();
    sendRemoteInput({
      kind: 'keyboard',
      action: 'up',
      key: event.key,
    });
  };

  const handleBack = () => {
    if (globalThis.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/screen-share');
    }
  };

  return renderPlayerRTCView({
    isMobileLayout,
    useNativeMobilePlayer,
    statusLabel,
    rtcStatus,
    signalStatus,
    hasRemoteStream,
    controlsVisible,
    isFullscreen,
    volume,
    isMuted,
    streamError,
    state,
    remoteVideoRef,
    viewerSurfaceRef,
    playerFrameRef,
    handleBack,
    handleViewerMouseMove,
    handleViewerMouseDown,
    handleViewerMouseUp,
    handleViewerWheel,
    handleViewerKeyDown,
    handleViewerKeyUp,
    revealControls,
    toggleMute,
    handleVolumeChange,
    toggleFullscreen,
    sendRemoteControl,
  });
}
