import React, { useRef, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useResponsive } from "./hooks/useResponsive";
import { useScreenShareState } from "../../shared/hooks/useScreenShareState";
import type {
  RemoteControlPayload,
  ScreenShareSessionState,
} from "../../shared/types";
import { useWebRTCViewer } from "./hooks/useWebRTCViewer";
import { usePlayerControls } from "./hooks/usePlayerControls";
import { navigateBackInApp } from "./utils/navigation";
import { buildAuthQuery, getRemoteServerToken } from "./utils/authTokens";
import "./styles/PlayerRTC.css";

const RELAY_STORAGE_KEY = "nsv_remote_relay_origin";

function getAuthQueryFromStorage(): string {
  const pairedToken = getRemoteServerToken();
  const serverUrl = globalThis.localStorage.getItem("nsv_server_url");
  const authTarget = pairedToken && serverUrl ? "remote" : "local";
  return buildAuthQuery(authTarget);
}

function normalizeRelayOrigin(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return new URL(withScheme).origin;
}

function formatStartedAt(startedAt: number | null): string {
  if (!startedAt) return "Not started";
  const date = new Date(startedAt);
  return date.toLocaleString();
}

const pointerButtonFromMouseEvent = (
  button: number,
): "left" | "middle" | "right" => {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
};

const normalizedPointerPosition = (
  event: React.MouseEvent<HTMLButtonElement>,
  surface: HTMLButtonElement | null,
) => {
  if (!surface) {
    return { x: 0.5, y: 0.5 };
  }

  const rect = surface.getBoundingClientRect();
  const x = Math.min(
    1,
    Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)),
  );
  const y = Math.min(
    1,
    Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)),
  );

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
    | "statusLabel"
    | "rtcStatus"
    | "signalStatus"
    | "handleBack"
    | "sendRemoteControl"
  >
>;

type PlayerRTCSidebarProps = Readonly<{
  isMobileLayout: boolean;
  statusLabel: string;
  signalStatus: string;
  rtcStatus: string;
  hasRemoteStream: boolean;
  sendRemoteControl: (payload: RemoteControlPayload) => void;
  state: PlayerRTCViewProps["state"];
}>;

function PlayerRTCTransportControls({
  hasRemoteStream,
  sendRemoteControl,
}: Readonly<{
  hasRemoteStream: boolean;
  sendRemoteControl: (payload: RemoteControlPayload) => void;
}>) {
  return (
    <div className="rtc-controls-box">
      <div className="rtc-label-small">Contrôles</div>
      <div className="rtc-controls-grid">
        <button
          type="button"
          className="rtc-control-btn"
          disabled={!hasRemoteStream}
          onClick={() => sendRemoteControl({ command: "seek", value: -10 })}
        >
          ← 10s
        </button>
        <button
          type="button"
          className="rtc-control-btn"
          disabled={!hasRemoteStream}
          onClick={() => sendRemoteControl({ command: "seek", value: 10 })}
        >
          10s →
        </button>
        <button
          type="button"
          className="rtc-control-btn"
          disabled={!hasRemoteStream}
          onClick={() => sendRemoteControl({ command: "play" })}
        >
          Play
        </button>
        <button
          type="button"
          className="rtc-control-btn"
          disabled={!hasRemoteStream}
          onClick={() => sendRemoteControl({ command: "pause" })}
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
      className="rtc-header"
      style={{
        padding: isMobileLayout ? "10px 12px" : "10px 20px",
        gap: isMobileLayout ? "8px" : "10px",
      }}
    >
      <button onClick={handleBack} className="rtc-back-btn" type="button">
        Back
      </button>

      <h2 className="rtc-header-title">Screen Share</h2>

      <span className="rtc-header-status">
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
      className="rtc-overlay-controls"
      style={{
        bottom: isMobileLayout ? "8px" : "14px",
        width: isMobileLayout
          ? "calc(100% - 16px)"
          : "min(620px, calc(100% - 28px))",
        flexWrap: isMobileLayout ? "wrap" : "nowrap",
      }}
    >
      <button
        type="button"
        onClick={() => {
          toggleMute();
          revealControls();
        }}
        className="rtc-mini-btn"
        aria-label={isMuted ? "Activer le son" : "Couper le son"}
      >
        {isMuted || volume <= 0 ? "Son coupe" : "Son actif"}
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
        className="rtc-volume-slider"
        style={{
          flex: isMobileLayout ? "1 1 100%" : 1,
          order: isMobileLayout ? 3 : 0,
        }}
      />

      <span className="rtc-volume-text">
        {Math.round((isMuted ? 0 : volume) * 100)}%
      </span>

      <button
        type="button"
        onClick={() => {
          void toggleFullscreen();
          revealControls();
        }}
        className="rtc-mini-btn"
        aria-label={
          isFullscreen ? "Quitter le plein ecran" : "Activer le plein ecran"
        }
      >
        {isFullscreen ? "Quitter plein ecran" : "Plein ecran"}
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
      className="rtc-video"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <video
        ref={remoteVideoRef}
        className="screen-share-video rtc-video"
        autoPlay
        playsInline
        muted={isMuted}
        controls
        controlsList="nodownload noplaybackrate"
      >
        <track kind="captions" />
      </video>
    </div>
  ) : (
    <button
      ref={viewerSurfaceRef}
      type="button"
      className="screen-share-remote-surface rtc-remote-surface"
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
        className="screen-share-video rtc-video"
        autoPlay
        playsInline
      >
        <track kind="captions" />
      </video>
    </button>
  );

  return (
    <div
      ref={playerFrameRef}
      className="rtc-viewport"
      style={{
        minHeight: isMobileLayout ? "50vh" : undefined,
        cursor:
          isFullscreen && hasRemoteStream && !controlsVisible
            ? "none"
            : "default",
      }}
    >
      {hasRemoteStream ? (
        remoteStreamNode
      ) : (
        <div className="rtc-waiting-host">
          <div style={{ fontSize: "18px", marginBottom: "8px" }}>
            Waiting for host stream...
          </div>
          <div className="rtc-label-small" style={{ fontSize: "14px" }}>
            {state.streamMessage ||
              "When the host starts sharing, the WebRTC feed will appear here."}
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

      {streamError && <div className="rtc-error-toast">{streamError}</div>}
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
      className="rtc-sidebar"
      style={{
        width: isMobileLayout ? "100%" : "320px",
        borderLeft: isMobileLayout ? "none" : "1px solid #3a3a3d",
        borderTop: isMobileLayout ? "1px solid #3a3a3d" : "none",
        padding: isMobileLayout ? "12px" : "16px",
        maxHeight: isMobileLayout ? "38vh" : "none",
        overflowY: isMobileLayout ? "auto" : "visible",
      }}
    >
      <PlayerRTCTransportControls
        hasRemoteStream={hasRemoteStream}
        sendRemoteControl={sendRemoteControl}
      />

      <div>
        <div className="rtc-label-small" style={{ marginBottom: "4px" }}>
          Session
        </div>
        <div className="rtc-value-bold">{state.sessionId || "Not started"}</div>
      </div>

      <div>
        <div className="rtc-label-small" style={{ marginBottom: "4px" }}>
          Source
        </div>
        <div className="rtc-value-bold">
          {state.sourceLabel || "No source"} ({state.sourceType || "n/a"})
        </div>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}
      >
        <div>
          <div className="rtc-label-small" style={{ marginBottom: "4px" }}>
            Status
          </div>
          <div className="rtc-value-normal">{statusLabel}</div>
        </div>
        <div>
          <div className="rtc-label-small" style={{ marginBottom: "4px" }}>
            Viewers
          </div>
          <div className="rtc-value-normal">
            {state.currentViewers}/{state.maxViewers}
          </div>
        </div>
        <div>
          <div className="rtc-label-small" style={{ marginBottom: "4px" }}>
            Signal
          </div>
          <div className="rtc-value-normal">{signalStatus}</div>
        </div>
        <div>
          <div className="rtc-label-small" style={{ marginBottom: "4px" }}>
            WebRTC
          </div>
          <div className="rtc-value-normal">{rtcStatus}</div>
        </div>
      </div>

      <div>
        <div className="rtc-label-small" style={{ marginBottom: "4px" }}>
          Started
        </div>
        <div className="rtc-value-normal">
          {formatStartedAt(state.startedAt)}
        </div>
      </div>

      <div className="rtc-label-small" style={{ marginTop: "8px" }}>
        {state.interactive
          ? "Pointer/keyboard input forwarded to host."
          : "Remote control disabled by host."}
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
    <div className="rtc-container">
      <PlayerRTCHeader
        isMobileLayout={isMobileLayout}
        statusLabel={statusLabel}
        rtcStatus={rtcStatus}
        signalStatus={signalStatus}
        handleBack={handleBack}
      />

      <div
        style={{
          display: "flex",
          flex: 1,
          overflow: "hidden",
          flexDirection: isMobileLayout ? "column" : "row",
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
  const sessionIdParam = searchParams.get("sessionId");
  const relayParam = searchParams.get("relay") || "";

  const relayOrigin = useMemo(() => {
    const candidate =
      relayParam ||
      globalThis.localStorage.getItem(RELAY_STORAGE_KEY) ||
      globalThis.localStorage.getItem("nsv_server_url") ||
      "";
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
    const statePath = "/api/screenshare/state";
    const endpointBase = relayOrigin ? `${relayOrigin}${statePath}` : statePath;
    const endpoint = authQuery ? `${endpointBase}?${authQuery}` : endpointBase;

    const response = await fetch(endpoint);
    if (!response.ok) throw new Error("Failed to fetch state");
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
  } = useWebRTCViewer(
    sessionIdParam,
    state,
    setState,
    remoteVideoRef,
    relayOrigin,
  );

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
    if (!state.active) return "Offline";
    return state.streamReady ? "Live" : "Preparing";
  }, [state.active, state.streamReady]);

  const useNativeMobilePlayer = isMobileLayout || isTouchDevice;

  const handleViewerMouseMove = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    revealControls();
    // eslint-disable-next-line react-hooks/purity
    const now = performance.now();
    if (now - lastPointerMoveRef.current < 8) {
      return;
    }
    lastPointerMoveRef.current = now;

    const pos = normalizedPointerPosition(event, viewerSurfaceRef.current);
    sendRemoteInput({
      kind: "pointer",
      action: "move",
      x: pos.x,
      y: pos.y,
    });
  };

  const handleViewerMouseDown = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    revealControls();
    const pos = normalizedPointerPosition(event, viewerSurfaceRef.current);
    sendRemoteInput({
      kind: "pointer",
      action: "down",
      button: pointerButtonFromMouseEvent(event.button),
      x: pos.x,
      y: pos.y,
    });
  };

  const handleViewerMouseUp = (event: React.MouseEvent<HTMLButtonElement>) => {
    revealControls();
    const pos = normalizedPointerPosition(event, viewerSurfaceRef.current);
    sendRemoteInput({
      kind: "pointer",
      action: "up",
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
      ? Math.min(
          1,
          Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)),
        )
      : 0.5;
    const y = rect
      ? Math.min(
          1,
          Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)),
        )
      : 0.5;
    sendRemoteInput({
      kind: "pointer",
      action: "wheel",
      x,
      y,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    });
  };

  const handleViewerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    revealControls();
    if (event.repeat) {
      return;
    }
    sendRemoteInput({
      kind: "keyboard",
      action: "down",
      key: event.key,
    });
  };

  const handleViewerKeyUp = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    revealControls();
    sendRemoteInput({
      kind: "keyboard",
      action: "up",
      key: event.key,
    });
  };

  const handleBack = () => {
    navigateBackInApp(navigate, "/screen-share");
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
