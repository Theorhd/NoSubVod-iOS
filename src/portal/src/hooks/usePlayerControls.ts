import { useState, useEffect, useRef, useCallback } from "react";

export function usePlayerControls(
  hasRemoteStream: boolean,
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>,
  playerFrameRef: React.RefObject<HTMLDivElement | null>,
) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const controlsHideTimerRef = useRef<ReturnType<
    typeof globalThis.setTimeout
  > | null>(null);

  useEffect(() => {
    const onFullScreenChanged = () => {
      const frame = playerFrameRef.current;
      setIsFullscreen(Boolean(frame && document.fullscreenElement === frame));
    };

    document.addEventListener("fullscreenchange", onFullScreenChanged);
    return () =>
      document.removeEventListener("fullscreenchange", onFullScreenChanged);
  }, [playerFrameRef]);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isMuted;
  }, [isMuted, volume, hasRemoteStream, remoteVideoRef]);

  const toggleFullscreen = useCallback(async () => {
    const frame = playerFrameRef.current;
    if (!frame) return;

    try {
      if (document.fullscreenElement === frame) {
        await document.exitFullscreen();
      } else if (frame.requestFullscreen) {
        await frame.requestFullscreen();
      } else {
        const video = remoteVideoRef.current as HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
        };
        if (video?.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
        }
      }
    } catch {
      const video = remoteVideoRef.current as HTMLVideoElement & {
        webkitEnterFullscreen?: () => void;
      };
      if (video?.webkitEnterFullscreen) {
        try {
          video.webkitEnterFullscreen();
        } catch {
          // Ignore fullscreen API errors (browser permissions/user gesture constraints).
        }
      }
    }
  }, [playerFrameRef, remoteVideoRef]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const handleVolumeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(event.target.value);
      if (!Number.isFinite(next)) return;
      setVolume(next);
      if (next > 0) {
        setIsMuted(false);
      }
    },
    [],
  );

  const scheduleControlsHide = useCallback(() => {
    if (controlsHideTimerRef.current) {
      globalThis.clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    }

    if (!isFullscreen || !hasRemoteStream) {
      return;
    }

    controlsHideTimerRef.current = globalThis.setTimeout(() => {
      setControlsVisible(false);
    }, 2000);
  }, [hasRemoteStream, isFullscreen]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);

    const video = remoteVideoRef.current;
    if (video?.paused) {
      const playAttempt = video.play();
      void playAttempt;
    }

    scheduleControlsHide();
  }, [remoteVideoRef, scheduleControlsHide]);

  useEffect(() => {
    if (!hasRemoteStream) {
      if (controlsHideTimerRef.current) {
        globalThis.clearTimeout(controlsHideTimerRef.current);
        controlsHideTimerRef.current = null;
      }
      return;
    }

    scheduleControlsHide();
  }, [hasRemoteStream, isFullscreen, scheduleControlsHide]);

  useEffect(() => {
    return () => {
      if (controlsHideTimerRef.current) {
        globalThis.clearTimeout(controlsHideTimerRef.current);
        controlsHideTimerRef.current = null;
      }
    };
  }, []);

  return {
    isFullscreen,
    volume,
    isMuted,
    controlsVisible,
    toggleFullscreen,
    toggleMute,
    handleVolumeChange,
    revealControls,
  };
}
