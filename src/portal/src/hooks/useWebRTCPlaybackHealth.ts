import { useCallback, useRef } from "react";

export function useWebRTCPlaybackHealth(
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>,
  remoteInboundStreamRef: React.MutableRefObject<MediaStream | null>,
  setStreamError: (err: string) => void,
  forceViewerReconnect: () => void,
) {
  const lastPlaybackTimeRef = useRef(0);
  const frozenTickCountRef = useRef(0);

  const recoverRemotePlayback = useCallback(() => {
    const video = remoteVideoRef.current;
    if (!video) return;
    const inbound = remoteInboundStreamRef.current;
    const currentObject = video.srcObject as MediaStream | null;
    if (inbound && currentObject !== inbound) {
      video.srcObject = inbound;
    }
    if (video.paused || video.readyState < 2) {
      void video.play().catch(() => undefined);
    }
  }, [remoteVideoRef, remoteInboundStreamRef]);

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
          setStreamError("Flux bloqué détecté. Reconnexion du viewer...");
          forceViewerReconnect();
          frozenTickCountRef.current = 0;
        }
      } else if (!video.paused && !ready) {
        frozenTickCountRef.current += 1;
        if (frozenTickCountRef.current >= 4) {
          recoverRemotePlayback();
        }
        if (frozenTickCountRef.current >= 7) {
          setStreamError("Vidéo noire détectée. Reconnexion du viewer...");
          forceViewerReconnect();
          frozenTickCountRef.current = 0;
        }
      }
      lastPlaybackTimeRef.current = currentTime;
    },
    [forceViewerReconnect, recoverRemotePlayback, setStreamError],
  );

  const resetHealthCounters = useCallback(() => {
    frozenTickCountRef.current = 0;
    lastPlaybackTimeRef.current = 0;
  }, []);

  return { evaluatePlaybackHealth, recoverRemotePlayback, resetHealthCounters };
}
