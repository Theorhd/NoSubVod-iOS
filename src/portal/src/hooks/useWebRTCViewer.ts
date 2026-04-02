import { useState, useEffect, useRef, useCallback, Dispatch, SetStateAction } from 'react';
import type {
  ScreenShareSessionState,
  RemoteInputPayload,
  RemoteControlPayload,
  WsMessage,
} from '../../../shared/types';

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function hasLiveUnmutedTrack(stream: MediaStream): boolean {
  for (const track of stream.getTracks()) {
    if (track.readyState === 'live' && !track.muted) {
      return true;
    }
  }
  return false;
}

export function useWebRTCViewer(
  sessionIdParam: string | null,
  state: ScreenShareSessionState,
  setState: Dispatch<SetStateAction<ScreenShareSessionState>>,
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>,
  relayOrigin: string | null = null
) {
  const [signalStatus, setSignalStatus] = useState('Disconnected');
  const [rtcStatus, setRtcStatus] = useState('Idle');
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [streamError, setStreamError] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const hostClientIdRef = useRef<string | null>(null);
  const viewerPeerRef = useRef<RTCPeerConnection | null>(null);
  const remoteInboundStreamRef = useRef<MediaStream | null>(null);
  const lastPlaybackTimeRef = useRef(0);
  const frozenTickCountRef = useRef(0);
  const lastHardRecoveryAtRef = useRef(0);
  const reconnectDelayMsRef = useRef(1500);

  const recoverRemotePlayback = useCallback(() => {
    const video = remoteVideoRef.current;
    if (!video) {
      return;
    }

    const inbound = remoteInboundStreamRef.current;
    const currentObject = video.srcObject as MediaStream | null;

    if (inbound && currentObject !== inbound) {
      video.srcObject = inbound;
    }

    if (video.paused || video.readyState < 2) {
      void video.play().catch(() => undefined);
    }
  }, [remoteVideoRef]);

  const forceViewerReconnect = useCallback(() => {
    const now = Date.now();
    if (now - lastHardRecoveryAtRef.current < 8000) {
      return;
    }
    lastHardRecoveryAtRef.current = now;

    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      // Closing signaling forces a clean reconnect + fresh join/offer cycle.
      ws.close();
      return;
    }

    if (ws?.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }, []);

  const evaluatePlaybackHealth = useCallback(
    (video: HTMLVideoElement) => {
      const currentTime = video.currentTime || 0;
      const ready = video.readyState >= 2;

      if (!video.paused && ready) {
        if (Math.abs(currentTime - lastPlaybackTimeRef.current) < 0.001) {
          frozenTickCountRef.current += 1;
        } else {
          frozenTickCountRef.current = 0;
        }

        if (frozenTickCountRef.current >= 3) {
          recoverRemotePlayback();
        }

        if (frozenTickCountRef.current >= 6) {
          setStreamError('Flux bloque detecte. Reconnexion du viewer...');
          forceViewerReconnect();
          frozenTickCountRef.current = 0;
        }
      } else if (!video.paused && !ready) {
        frozenTickCountRef.current += 1;
        if (frozenTickCountRef.current >= 4) {
          recoverRemotePlayback();
        }
        if (frozenTickCountRef.current >= 7) {
          setStreamError('Video noire detectee. Reconnexion du viewer...');
          forceViewerReconnect();
          frozenTickCountRef.current = 0;
        }
      }

      lastPlaybackTimeRef.current = currentTime;
    },
    [forceViewerReconnect, recoverRemotePlayback]
  );

  const attachInboundStreamToVideo = useCallback(
    (stream: MediaStream) => {
      const video = remoteVideoRef.current;
      if (!video) {
        return;
      }

      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }

      void video.play().catch(() => undefined);
    },
    [remoteVideoRef]
  );

  const getAuthQuery = useCallback(() => {
    const token =
      globalThis.sessionStorage.getItem('nsv_token') ||
      globalThis.localStorage.getItem('nsv_token');
    const deviceId = globalThis.localStorage.getItem('nsv_device_id');
    const params = new URLSearchParams();
    if (token) {
      params.set('t', token);
    }
    if (deviceId) {
      params.set('d', deviceId);
    }
    return params.toString();
  }, []);

  const sendWs = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify(payload));
  }, []);

  const sendRemoteInput = useCallback(
    (payload: RemoteInputPayload) => {
      if (!hasRemoteStream || !state.interactive) {
        return;
      }

      sendWs({
        type: 'input',
        payload,
      });
    },
    [hasRemoteStream, state.interactive, sendWs]
  );

  const sendRemoteControl = useCallback(
    (payload: RemoteControlPayload) => {
      if (!hasRemoteStream) {
        return;
      }

      sendWs({
        type: 'control',
        payload,
      });
    },
    [hasRemoteStream, sendWs]
  );

  const cleanupViewerPeer = useCallback(() => {
    const peer = viewerPeerRef.current;
    if (peer) {
      peer.close();
      viewerPeerRef.current = null;
    }
    remoteInboundStreamRef.current = null;
  }, []);

  const ensureViewerPeer = useCallback(async (): Promise<RTCPeerConnection> => {
    const existing = viewerPeerRef.current;
    if (existing) return existing;

    const peer = new RTCPeerConnection(rtcConfig);
    viewerPeerRef.current = peer;

    peer.ontrack = (event) => {
      const inbound = remoteInboundStreamRef.current ?? new MediaStream();
      remoteInboundStreamRef.current = inbound;

      const incomingTrack = event.track;
      const hasTrack = inbound.getTracks().some((track) => track.id === incomingTrack.id);
      if (!hasTrack) {
        inbound.addTrack(incomingTrack);
      }

      setHasRemoteStream(true);
      const audioTracks = inbound.getAudioTracks();
      if (audioTracks.length === 0) {
        setStreamError("Flux recu sans piste audio depuis l'hote.");
      } else {
        setStreamError('');
      }

      // Re-assign a new MediaStream instance so the video element picks up newly added tracks.
      const newStream = event.streams?.[0] ?? new MediaStream(inbound.getTracks());
      globalThis.setTimeout(() => attachInboundStreamToVideo(newStream), 10);

      const onTrackEnded = () => {
        if (!hasLiveUnmutedTrack(inbound)) {
          setHasRemoteStream(false);
        }
      };

      incomingTrack.addEventListener('ended', onTrackEnded);
      incomingTrack.addEventListener('mute', recoverRemotePlayback);
      incomingTrack.addEventListener('unmute', recoverRemotePlayback);
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        setRtcStatus('WebRTC live (viewer)');
      } else if (peer.connectionState === 'failed') {
        setStreamError('WebRTC connection failed');
      }
    };

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      const hostIdCurrent = hostClientIdRef.current;
      if (!hostIdCurrent) return;
      sendWs({
        type: 'signal',
        target: hostIdCurrent,
        payload: { candidate: event.candidate.toJSON() },
      });
    };

    peer.onicecandidateerror = (event: Event) => {
      console.error('Viewer ICE error:', event);
    };

    return peer;
  }, [attachInboundStreamToVideo, recoverRemotePlayback, sendWs]);

  const handleSignalSdp = useCallback(
    async (from: string, sdp: RTCSessionDescriptionInit) => {
      const hostId = hostClientIdRef.current;
      if (!hostId || from !== hostId) return;
      if (sdp.type !== 'offer') return;

      try {
        const peer = await ensureViewerPeer();
        await peer.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        sendWs({
          type: 'signal',
          target: hostId,
          payload: { sdp: answer },
        });
        setRtcStatus('WebRTC negotiating (viewer)');
      } catch (error: any) {
        console.error('Failed to handle offer on viewer:', error);
        setStreamError(`Viewer WebRTC error: ${error.message}`);
      }
    },
    [ensureViewerPeer, sendWs]
  );

  const handleSignalCandidate = useCallback(
    async (from: string, candidate: RTCIceCandidateInit) => {
      const hostId = hostClientIdRef.current;
      if (!hostId || from !== hostId) return;
      const peer = await ensureViewerPeer();
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    },
    [ensureViewerPeer]
  );

  const handleSignalMessage = useCallback(
    async (message: WsMessage) => {
      const target = message.target;
      const me = clientIdRef.current;
      if (target && me && target !== me) {
        return;
      }

      const from = message.from;
      const payload = message.payload;
      if (!from || !payload) {
        return;
      }

      if (payload.sdp) {
        await handleSignalSdp(from, payload.sdp);
        return;
      }

      if (payload.candidate) {
        await handleSignalCandidate(from, payload.candidate);
      }
    },
    [handleSignalCandidate, handleSignalSdp]
  );

  const handleWelcomeMessage = useCallback(
    (message: WsMessage) => {
      if (message.state) {
        setState(message.state);
      }
      clientIdRef.current = message.clientId || null;
      hostClientIdRef.current = message.hostClientId || null;

      const joinPayload: Record<string, unknown> = { type: 'join', role: 'viewer' };
      if (sessionIdParam) {
        joinPayload.sessionId = sessionIdParam;
      }
      sendWs(joinPayload);
    },
    [sessionIdParam, sendWs, setState]
  );

  const handlePeerJoinedMessage = useCallback((message: WsMessage) => {
    if (message.role === 'host') {
      hostClientIdRef.current = message.clientId || null;
    }
  }, []);

  const handlePeerLeftMessage = useCallback(
    (message: WsMessage) => {
      if (message.role === 'host') {
        hostClientIdRef.current = null;
        cleanupViewerPeer();
        setHasRemoteStream(false);
        setRtcStatus('Host disconnected');
      }
    },
    [cleanupViewerPeer]
  );

  const applyWsMessage = useCallback(
    (message: WsMessage) => {
      switch (message.type) {
        case 'welcome':
          handleWelcomeMessage(message);
          return;
        case 'session-state':
          if (message.state) {
            setState(message.state);
          }
          return;
        case 'peer-joined':
          handlePeerJoinedMessage(message);
          return;
        case 'peer-left':
          handlePeerLeftMessage(message);
          return;
        case 'signal':
          void handleSignalMessage(message);
          return;
        case 'system':
          if (message.message) {
            setState((current: ScreenShareSessionState) => ({
              ...current,
              streamMessage: message.message ?? null,
            }));
          }
          return;
        case 'error':
          if (message.message) {
            setStreamError(message.message);
          }
          return;
        default:
          return;
      }
    },
    [
      handlePeerJoinedMessage,
      handlePeerLeftMessage,
      handleSignalMessage,
      handleWelcomeMessage,
      setState,
    ]
  );

  const applyWsMessageRef = useRef(applyWsMessage);
  useEffect(() => {
    applyWsMessageRef.current = applyWsMessage;
  }, [applyWsMessage]);

  useEffect(() => {
    const tauriRuntime = Boolean(
      (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    );
    if (tauriRuntime && !relayOrigin) {
      setSignalStatus('Unavailable');
      setRtcStatus('Requires NSV relay server');
      setStreamError('ScreenShare requires a remote NSV server in iOS mode.');
      return;
    }

    const baseHttpOrigin = relayOrigin || globalThis.location.origin;

    let disposed = false;
    let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

    const connect = () => {
      if (disposed) {
        return;
      }

      const wsParams = new URLSearchParams(getAuthQuery());
      if (sessionIdParam) {
        wsParams.set('sessionId', sessionIdParam);
      }

      const wsEndpoint = new URL('/api/screenshare/ws', baseHttpOrigin);
      const mergedParams = new URLSearchParams(wsEndpoint.search);
      wsParams.forEach((value, key) => mergedParams.set(key, value));
      wsEndpoint.search = mergedParams.toString();
      wsEndpoint.protocol = wsEndpoint.protocol === 'https:' ? 'wss:' : 'ws:';

      const wsUrl = wsEndpoint.toString();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        setSignalStatus('Connected');
        setRtcStatus('Signaling connected');
        reconnectDelayMsRef.current = 1500;
      });

      ws.addEventListener('close', () => {
        setSignalStatus('Disconnected');
        setRtcStatus('Signaling disconnected');
        cleanupViewerPeer();
        setHasRemoteStream(false);

        if (!disposed) {
          const isVisible = document.visibilityState === 'visible';
          const delay = isVisible
            ? reconnectDelayMsRef.current
            : Math.max(reconnectDelayMsRef.current, 5000);
          reconnectTimer = globalThis.setTimeout(connect, delay);
          reconnectDelayMsRef.current = Math.min(reconnectDelayMsRef.current * 2, 10000);
        }
      });

      ws.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(event.data) as WsMessage;
          applyWsMessageRef.current(message);
        } catch {
          // Ignore malformed realtime payloads.
        }
      });
    };

    connect();

    const pingTimer = globalThis.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);

    return () => {
      disposed = true;
      globalThis.clearInterval(pingTimer);
      if (reconnectTimer !== undefined) {
        globalThis.clearTimeout(reconnectTimer);
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.close();
      }
      cleanupViewerPeer();
    };
  }, [sessionIdParam, getAuthQuery, cleanupViewerPeer, relayOrigin]);

  useEffect(() => {
    if (!hasRemoteStream) {
      return;
    }

    const onViewportChanged = () => {
      // Mobile fullscreen + orientation can pause rendering while stream is still alive.
      // Try to rebind and resume playback immediately.
      recoverRemotePlayback();
      frozenTickCountRef.current = 0;
    };

    const onVisibilityChanged = () => {
      if (document.visibilityState === 'visible') {
        onViewportChanged();
      }
    };

    globalThis.addEventListener('orientationchange', onViewportChanged);
    globalThis.addEventListener('resize', onViewportChanged);
    globalThis.addEventListener('pageshow', onViewportChanged);
    document.addEventListener('fullscreenchange', onViewportChanged);
    document.addEventListener('visibilitychange', onVisibilityChanged);

    return () => {
      globalThis.removeEventListener('orientationchange', onViewportChanged);
      globalThis.removeEventListener('resize', onViewportChanged);
      globalThis.removeEventListener('pageshow', onViewportChanged);
      document.removeEventListener('fullscreenchange', onViewportChanged);
      document.removeEventListener('visibilitychange', onVisibilityChanged);
    };
  }, [hasRemoteStream, recoverRemotePlayback]);

  useEffect(() => {
    if (!hasRemoteStream) {
      frozenTickCountRef.current = 0;
      lastPlaybackTimeRef.current = 0;
      return;
    }

    const timer = globalThis.setInterval(() => {
      const video = remoteVideoRef.current;
      if (!video || document.visibilityState !== 'visible') {
        return;
      }
      evaluatePlaybackHealth(video);
    }, 1500);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, [evaluatePlaybackHealth, hasRemoteStream, remoteVideoRef]);

  return {
    signalStatus,
    rtcStatus,
    hasRemoteStream,
    setHasRemoteStream,
    streamError,
    sendRemoteInput,
    sendRemoteControl,
  };
}
