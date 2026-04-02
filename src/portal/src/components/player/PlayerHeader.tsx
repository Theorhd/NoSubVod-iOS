import React from "react";

interface PlayerHeaderProps {
  onBack: () => void;
  isMobileLayout: boolean;
  statusLabel: string;
  rtcStatus: string;
  signalStatus: string;
}

export const PlayerHeader: React.FC<PlayerHeaderProps> = ({
  onBack,
  isMobileLayout,
  statusLabel,
  rtcStatus,
  signalStatus,
}) => {
  return (
    <div
      style={{
        backgroundColor: "#18181b",
        padding: isMobileLayout ? "10px 12px" : "10px 20px",
        display: "flex",
        alignItems: "center",
        borderBottom: "1px solid #3a3a3d",
        zIndex: 10,
        flexShrink: 0,
        gap: isMobileLayout ? "8px" : "10px",
      }}
    >
      <button
        onClick={onBack}
        style={{
          color: "#efeff1",
          fontSize: "14px",
          fontWeight: "bold",
          padding: "5px 10px",
          backgroundColor: "#3a3a3d",
          borderRadius: "4px",
          border: "none",
          cursor: "pointer",
        }}
        type="button"
      >
        Back
      </button>

      <h2
        style={{
          color: "white",
          fontSize: "14px",
          margin: 0,
          flexGrow: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        Screen Share
      </h2>

      <span style={{ color: "#efeff1", fontSize: "12px" }}>
        {isMobileLayout
          ? `${statusLabel} · ${rtcStatus}`
          : `${statusLabel} · ${signalStatus} · ${rtcStatus}`}
      </span>
    </div>
  );
};
