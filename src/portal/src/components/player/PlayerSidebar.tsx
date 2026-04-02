import React from "react";
import type { ScreenShareSessionState } from "../../../../shared/types";

interface PlayerSidebarProps {
  isMobileLayout: boolean;
  state: ScreenShareSessionState;
  statusLabel: string;
  signalStatus: string;
  rtcStatus: string;
  formatStartedAt: (startedAt: number | null) => string;
}

export const PlayerSidebar: React.FC<PlayerSidebarProps> = ({
  isMobileLayout,
  state,
  statusLabel,
  signalStatus,
  rtcStatus,
  formatStartedAt,
}) => {
  return (
    <div
      style={{
        width: isMobileLayout ? "100%" : "320px",
        backgroundColor: "#0e0e10",
        borderLeft: isMobileLayout ? "none" : "1px solid #3a3a3d",
        borderTop: isMobileLayout ? "1px solid #3a3a3d" : "none",
        padding: isMobileLayout ? "12px" : "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        flexShrink: 0,
        maxHeight: isMobileLayout ? "38vh" : "none",
        overflowY: isMobileLayout ? "auto" : "visible",
      }}
    >
      <div>
        <div
          style={{ color: "#a1a1aa", fontSize: "12px", marginBottom: "4px" }}
        >
          Session
        </div>
        <div style={{ color: "#efeff1", fontSize: "14px", fontWeight: "bold" }}>
          {state.sessionId || "Not started"}
        </div>
      </div>

      <div>
        <div
          style={{ color: "#a1a1aa", fontSize: "12px", marginBottom: "4px" }}
        >
          Source
        </div>
        <div style={{ color: "#efeff1", fontSize: "14px", fontWeight: "bold" }}>
          {state.sourceLabel || "No source"} ({state.sourceType || "n/a"})
        </div>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}
      >
        <div>
          <div
            style={{ color: "#a1a1aa", fontSize: "12px", marginBottom: "4px" }}
          >
            Status
          </div>
          <div style={{ color: "#efeff1", fontSize: "14px" }}>
            {statusLabel}
          </div>
        </div>
        <div>
          <div
            style={{ color: "#a1a1aa", fontSize: "12px", marginBottom: "4px" }}
          >
            Viewers
          </div>
          <div style={{ color: "#efeff1", fontSize: "14px" }}>
            {state.currentViewers}/{state.maxViewers}
          </div>
        </div>
        <div>
          <div
            style={{ color: "#a1a1aa", fontSize: "12px", marginBottom: "4px" }}
          >
            Signal
          </div>
          <div style={{ color: "#efeff1", fontSize: "14px" }}>
            {signalStatus}
          </div>
        </div>
        <div>
          <div
            style={{ color: "#a1a1aa", fontSize: "12px", marginBottom: "4px" }}
          >
            WebRTC
          </div>
          <div style={{ color: "#efeff1", fontSize: "14px" }}>{rtcStatus}</div>
        </div>
      </div>

      <div>
        <div
          style={{ color: "#a1a1aa", fontSize: "12px", marginBottom: "4px" }}
        >
          Started
        </div>
        <div style={{ color: "#efeff1", fontSize: "14px" }}>
          {formatStartedAt(state.startedAt)}
        </div>
      </div>

      <div style={{ color: "#a1a1aa", fontSize: "12px", marginTop: "8px" }}>
        {state.interactive
          ? "Pointer/keyboard input forwarded to host."
          : "Remote control disabled by host."}
      </div>
    </div>
  );
};
