// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWebRTCPlaybackHealth } from "./useWebRTCPlaybackHealth";

describe("useWebRTCPlaybackHealth", () => {
  let mockVideo: any;
  let mockStreamRef: any;
  let setStreamError: any;
  let forceViewerReconnect: any;

  beforeEach(() => {
    mockVideo = {
      currentTime: 10,
      readyState: 4,
      paused: false,
      srcObject: null,
      play: vi.fn().mockResolvedValue(undefined),
    };
    mockStreamRef = { current: { id: "stream-1" } };
    setStreamError = vi.fn();
    forceViewerReconnect = vi.fn();
  });

  it("detects frozen stream and attempts recovery", () => {
    const { result } = renderHook(() =>
      useWebRTCPlaybackHealth(
        { current: mockVideo },
        mockStreamRef,
        setStreamError,
        forceViewerReconnect,
      ),
    );

    // First evaluation
    result.current.evaluatePlaybackHealth(mockVideo);

    // Time doesn't change for 3 ticks
    result.current.evaluatePlaybackHealth(mockVideo);
    result.current.evaluatePlaybackHealth(mockVideo);
    result.current.evaluatePlaybackHealth(mockVideo); // Tick 3

    expect(mockVideo.srcObject).toBe(mockStreamRef.current);
  });

  it("forces reconnect after 6 frozen ticks", () => {
    const { result } = renderHook(() =>
      useWebRTCPlaybackHealth(
        { current: mockVideo },
        mockStreamRef,
        setStreamError,
        forceViewerReconnect,
      ),
    );

    for (let i = 0; i <= 6; i++) {
      result.current.evaluatePlaybackHealth(mockVideo);
    }

    expect(forceViewerReconnect).toHaveBeenCalled();
    expect(setStreamError).toHaveBeenCalledWith(
      expect.stringContaining("Flux bloqué"),
    );
  });
});
