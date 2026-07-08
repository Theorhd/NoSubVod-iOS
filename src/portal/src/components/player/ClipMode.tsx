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
    "idle" | "loading" | "success" | "error"
  >("idle");

  const handleDownload = async () => {
    if (downloadStatus !== "idle" && downloadStatus !== "error") return;
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
      console.error("[ClipMode] Error:", e);
      setDownloadStatus("error");
      setTimeout(() => setDownloadStatus("idle"), 3000);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        gap: "12px",
        alignItems: "center",
        margin: "12px 16px",
        background: "rgba(30, 30, 34, 0.95)",
        padding: "10px 14px",
        borderRadius: "20px",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        flexWrap: "wrap",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <style>{`
        .clip-btn {
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s ease, opacity 0.2s ease;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        .clip-btn:active {
          transform: scale(0.92);
        }
        .clip-action-btn:active {
          transform: scale(0.96);
        }
      `}</style>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginRight: "4px",
        }}
      >
        <div
          style={{
            background: "rgba(168, 85, 247, 0.2)",
            padding: "6px",
            borderRadius: "50%",
          }}
        >
          <Scissors size={18} color="var(--primary, #a855f7)" />
        </div>
        <span
          style={{
            color: "#fff",
            fontWeight: "700",
            fontSize: "0.95rem",
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
          background: "rgba(0,0,0,0.4)",
          borderRadius: "16px",
          padding: "4px",
        }}
      >
        <button
          className="clip-btn"
          type="button"
          onClick={onSetStart}
          style={{
            padding: "8px 14px",
            fontSize: "0.85rem",
            fontWeight: "700",
            background: "rgba(255, 255, 255, 0.1)",
            color: "#fff",
            border: "none",
            borderRadius: "12px",
            cursor: "pointer",
          }}
        >
          Début
        </button>
        <span
          style={{
            fontSize: "0.9rem",
            color: "#e4e4e7",
            fontFamily: "monospace",
            fontWeight: "600",
            padding: "0 12px",
          }}
        >
          {formatClock(clipStart || 0)}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "rgba(0,0,0,0.4)",
          borderRadius: "16px",
          padding: "4px",
        }}
      >
        <button
          className="clip-btn"
          type="button"
          onClick={onSetEnd}
          style={{
            padding: "8px 14px",
            fontSize: "0.85rem",
            fontWeight: "700",
            background: "rgba(255, 255, 255, 0.1)",
            color: "#fff",
            border: "none",
            borderRadius: "12px",
            cursor: "pointer",
          }}
        >
          Fin
        </button>
        <span
          style={{
            fontSize: "0.9rem",
            color: "#e4e4e7",
            fontFamily: "monospace",
            fontWeight: "600",
            padding: "0 12px",
          }}
        >
          {formatClock(clipEnd ?? duration)}
        </span>
      </div>

      <button
        type="button"
        className="clip-btn clip-action-btn"
        onClick={handleDownload}
        disabled={downloadStatus === "loading" || downloadStatus === "success"}
        style={{
          marginLeft: "auto",
          padding: "10px 18px",
          fontSize: "0.9rem",
          fontWeight: "700",
          borderRadius: "16px",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          background:
            downloadStatus === "success"
              ? "#10b981"
              : downloadStatus === "error"
                ? "#ef4444"
                : "var(--primary, #a855f7)",
          color: "#fff",
          boxShadow:
            downloadStatus === "idle"
              ? "0 4px 16px rgba(168, 85, 247, 0.3)"
              : "none",
          opacity:
            downloadStatus === "loading" || downloadStatus === "success"
              ? 0.9
              : 1,
        }}
      >
        {downloadStatus === "loading" ? (
          <Loader2 size={18} className="spinning" />
        ) : downloadStatus === "success" ? (
          <Check size={18} />
        ) : downloadStatus === "error" ? (
          <X size={18} />
        ) : (
          <DownloadIcon size={18} />
        )}
        <span>
          {downloadStatus === "loading"
            ? "Lancement..."
            : downloadStatus === "success"
              ? "Lancé"
              : downloadStatus === "error"
                ? "Erreur - Réessayer"
                : "Télécharger"}
        </span>
      </button>

      {onClose && (
        <button
          className="clip-btn"
          type="button"
          onClick={onClose}
          style={{
            padding: "10px",
            background: "rgba(255, 255, 255, 0.05)",
            color: "rgba(255, 255, 255, 0.8)",
            border: "none",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            marginLeft: "4px",
          }}
          title="Fermer le mode clip"
        >
          <X size={20} />
        </button>
      )}
    </div>
  );
};

export default ClipMode;
