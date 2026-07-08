import React, { useState } from "react";
import { VOD } from "../../../../shared/types";
import { formatSafeClock as formatClock } from "../../../../shared/utils/formatters";
import {
  X,
  Download as DownloadIcon,
  Loader2,
  Check,
  Scissors,
} from "lucide-react";
import { buildAuthSuffix } from "../../utils/authTokens";

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
      const authSuffix = buildAuthSuffix("local");
      const res = await fetch(`/api/download/start${authSuffix}`, {
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
        gap: "12px",
        alignItems: "center",
        margin: "12px 16px",
        background: "rgba(30, 30, 34, 0.8)",
        padding: "8px 12px 8px 16px",
        borderRadius: "16px",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          marginRight: "4px",
        }}
      >
        <Scissors size={16} color="var(--primary, #a855f7)" />
        <span
          style={{
            color: "#fff",
            fontWeight: "600",
            fontSize: "0.9rem",
            letterSpacing: "0.02em",
          }}
        >
          Clip
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "rgba(0,0,0,0.3)",
          borderRadius: "16px",
          padding: "4px",
        }}
      >
        <button
          type="button"
          onClick={onSetStart}
          style={{
            padding: "6px 12px",
            fontSize: "0.8rem",
            fontWeight: "600",
            background: "rgba(255, 255, 255, 0.08)",
            color: "#fff",
            border: "none",
            borderRadius: "12px",
            cursor: "pointer",
            transition: "background 0.2s ease",
          }}
          onMouseOver={(e) =>
            (e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)")
          }
          onMouseOut={(e) =>
            (e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)")
          }
        >
          Début
        </button>
        <span
          style={{
            fontSize: "0.85rem",
            color: "#a1a1aa",
            fontFamily: "monospace",
            padding: "0 10px",
          }}
        >
          {formatClock(clipStart || 0)}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "rgba(0,0,0,0.3)",
          borderRadius: "16px",
          padding: "4px",
        }}
      >
        <button
          type="button"
          onClick={onSetEnd}
          style={{
            padding: "6px 12px",
            fontSize: "0.8rem",
            fontWeight: "600",
            background: "rgba(255, 255, 255, 0.08)",
            color: "#fff",
            border: "none",
            borderRadius: "12px",
            cursor: "pointer",
            transition: "background 0.2s ease",
          }}
          onMouseOver={(e) =>
            (e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)")
          }
          onMouseOut={(e) =>
            (e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)")
          }
        >
          Fin
        </button>
        <span
          style={{
            fontSize: "0.85rem",
            color: "#a1a1aa",
            fontFamily: "monospace",
            padding: "0 10px",
          }}
        >
          {formatClock(clipEnd ?? duration)}
        </span>
      </div>

      <style>{`
        @keyframes spin-menu { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin-menu-icon { animation: spin-menu 1s linear infinite; }
      `}</style>

      <button
        type="button"
        onClick={handleDownload}
        style={{
          marginLeft: "auto",
          padding: "8px 16px",
          fontSize: "0.85rem",
          fontWeight: "600",
          borderRadius: "14px",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          background:
            downloadStatus === "success"
              ? "#22c55e"
              : "var(--primary, #a855f7)",
          color: "#fff",
          transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow:
            downloadStatus === "success"
              ? "0 4px 12px rgba(34, 197, 94, 0.3)"
              : "0 4px 12px rgba(168, 85, 247, 0.3)",
        }}
        onMouseOver={(e) => {
          if (downloadStatus !== "success")
            e.currentTarget.style.transform = "scale(1.05)";
        }}
        onMouseOut={(e) => {
          if (downloadStatus !== "success")
            e.currentTarget.style.transform = "scale(1)";
        }}
      >
        {downloadStatus === "loading" ? (
          <Loader2 size={16} className="spin-menu-icon" />
        ) : downloadStatus === "success" ? (
          <Check size={16} />
        ) : (
          <DownloadIcon size={16} />
        )}
        {downloadStatus === "loading"
          ? "Lancement..."
          : downloadStatus === "success"
            ? "Lancé"
            : "Télécharger"}
      </button>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: "8px",
            background: "transparent",
            color: "rgba(255, 255, 255, 0.6)",
            border: "none",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "all 0.2s ease",
            marginLeft: "4px",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
            e.currentTarget.style.color = "#fff";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "rgba(255, 255, 255, 0.6)";
          }}
          title="Fermer le mode clip"
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
};

export default ClipMode;
