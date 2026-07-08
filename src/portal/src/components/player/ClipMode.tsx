import React, { useState } from "react";
import { VOD } from "../../../../shared/types";
import { formatSafeClock as formatClock } from "../../../../shared/utils/formatters";
import { X, Download as DownloadIcon, Loader2, Check } from "lucide-react";

interface ClipModeProps {
  duration: number;
  clipStart: number | null;
  clipEnd: number | null;
  vodId: string;
  vodInfo: VOD | null;
  onSetStart: () => void;
  onSetEnd: () => void;
  onDownloadStart: () => void;
  onClose?: () => void;
}

const ClipMode: React.FC<ClipModeProps> = ({
  duration,
  clipStart,
  clipEnd,
  vodId,
  vodInfo,
  onSetStart,
  onSetEnd,
  onDownloadStart,
  onClose,
}) => {
  const [downloadStatus, setDownloadStatus] = useState<
    "idle" | "loading" | "success"
  >("idle");

  const handleDownload = async () => {
    if (downloadStatus !== "idle") return;
    setDownloadStatus("loading");
    try {
      const res = await fetch("/api/download/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vodId,
          title: vodInfo?.title || `Clip ${vodId}`,
          quality: "best",
          startTime: clipStart || 0,
          endTime: clipEnd ?? duration,
          duration,
        }),
      });
      if (res.ok) {
        setDownloadStatus("success");
        setTimeout(() => {
          onDownloadStart();
          setDownloadStatus("idle");
        }, 1500);
      } else {
        throw new Error("Failed to start clip download");
      }
    } catch (e) {
      alert(`Error: ${e}`);
      setDownloadStatus("idle");
    }
  };

  return (
    <div
      style={{
        display: "flex",
        gap: "10px",
        alignItems: "center",
        margin: "12px 16px",
        background: "rgba(0,0,0,0.35)",
        padding: "10px",
        borderRadius: "10px",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{ color: "#4ade80", fontWeight: "bold", fontSize: "0.9rem" }}
      >
        Clip Mode
      </span>
      <button
        type="button"
        onClick={onSetStart}
        className="action-btn"
        style={{ padding: "5px 10px", fontSize: "0.8rem" }}
      >
        Set Start
      </button>
      <span style={{ fontSize: "0.85rem", color: "#adadb8" }}>
        {formatClock(clipStart || 0)}
      </span>
      <button
        type="button"
        onClick={onSetEnd}
        className="action-btn"
        style={{ padding: "5px 10px", fontSize: "0.8rem" }}
      >
        Set End
      </button>
      <span style={{ fontSize: "0.85rem", color: "#adadb8" }}>
        {formatClock(clipEnd ?? duration)}
      </span>
      <style>{`
        @keyframes spin-menu { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin-menu-icon { animation: spin-menu 1s linear infinite; }
      `}</style>
      <button
        type="button"
        onClick={handleDownload}
        className="action-btn"
        style={{
          marginLeft: "auto",
          padding: "5px 12px",
          fontSize: "0.8rem",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background:
            downloadStatus === "success"
              ? "var(--success, #22c55e)"
              : undefined,
          color: downloadStatus === "success" ? "white" : undefined,
          transition: "all 0.3s ease",
        }}
      >
        {downloadStatus === "loading" ? (
          <Loader2 size={14} className="spin-menu-icon" />
        ) : downloadStatus === "success" ? (
          <Check size={14} />
        ) : (
          <DownloadIcon size={14} />
        )}
        {downloadStatus === "loading"
          ? "Lancement..."
          : downloadStatus === "success"
            ? "Lancé"
            : "Télécharger la sélection"}
      </button>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="secondary-btn"
          style={{
            padding: "5px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Fermer le mode clip"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
};

export default ClipMode;
