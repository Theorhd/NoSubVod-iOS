import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import {
  Download as DownloadIcon,
  Scissors,
  X,
  Loader2,
  Check,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { navigateToPlayer } from "../utils/navigation";
import { buildAuthSuffix } from "../utils/authTokens";

interface DownloadMenuProps {
  vodId: string;
  title?: string;
  duration?: number;
  onClose: () => void;
  anchorRect?: DOMRect | null; // Kept for backwards compatibility if needed elsewhere
}

export default function DownloadMenu({
  vodId,
  title,
  duration,
  onClose,
}: DownloadMenuProps) {
  const [quality, setQuality] = useState("best");
  const [isClosing, setIsClosing] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<
    "idle" | "loading" | "success"
  >("idle");
  const navigate = useNavigate();

  useEffect(() => {
    // Trigger the enter transition after the first render
    requestAnimationFrame(() => setIsMounted(true));
  }, []);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 400); // Matches the CSS transition duration
  };

  const handleFullDownload = async () => {
    if (downloadStatus !== "idle") return;
    setDownloadStatus("loading");
    try {
      const authSuffix = buildAuthSuffix("local");
      const res = await fetch(`/api/download/start${authSuffix}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vodId,
          title,
          quality,
          startTime: null,
          endTime: null,
          duration,
        }),
      });
      if (res.ok) {
        setDownloadStatus("success");
        setTimeout(() => handleClose(), 1500);
      } else {
        throw new Error("Failed to start download");
      }
    } catch (e) {
      console.error("[DownloadMenu] Download error:", e);
      alert("Erreur: " + e);
      setDownloadStatus("idle");
    }
  };

  const handleManualClip = () => {
    navigateToPlayer(navigate, {
      vodId,
      downloadMode: true,
    });
    handleClose();
  };

  const isVisible = isMounted && !isClosing;

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    zIndex: 99999,
    opacity: isVisible ? 1 : 0,
    transition: "opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    alignItems: "center", // Center horizontally on large screens
    paddingBottom: "env(safe-area-inset-bottom, 24px)",
    paddingLeft: "16px",
    paddingRight: "16px",
  };

  const sheetStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: "480px", // Limit width on desktop
    background: "rgba(30, 30, 34, 0.85)", // Deep dark glassmorphism
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: "28px",
    padding: "24px 28px",
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    transform: isVisible
      ? "translateY(0) scale(1)"
      : "translateY(40px) scale(0.95)",
    transition:
      "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease",
    boxShadow:
      "0 24px 48px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
    marginBottom: "16px",
  };

  const menu = (
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div style={sheetStyle} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "28px",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "1.4rem",
              fontWeight: "700",
              letterSpacing: "-0.02em",
              color: "#fff",
            }}
          >
            Téléchargement
          </h3>
          <button
            onClick={handleClose}
            style={{
              background: "rgba(255, 255, 255, 0.1)",
              border: "1px solid rgba(255, 255, 255, 0.05)",
              color: "#fff",
              cursor: "pointer",
              borderRadius: "50%",
              width: "36px",
              height: "36px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s ease",
            }}
            onMouseOver={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "rgba(255, 255, 255, 0.2)";
              (e.currentTarget as HTMLButtonElement).style.transform =
                "scale(1.05)";
            }}
            onMouseOut={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "rgba(255, 255, 255, 0.1)";
              (e.currentTarget as HTMLButtonElement).style.transform =
                "scale(1)";
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ marginBottom: "36px" }}>
          <span
            style={{
              display: "block",
              fontSize: "0.8rem",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: "16px",
              color: "rgba(255, 255, 255, 0.5)",
              fontWeight: "600",
            }}
          >
            Résolution
          </span>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            {[
              { value: "best", label: "Source" },
              { value: "1080p", label: "1080p" },
              { value: "720p", label: "720p" },
              { value: "480p", label: "480p" },
              { value: "360p", label: "360p" },
              { value: "160p", label: "160p" },
              { value: "audio", label: "Audio" },
            ].map((opt) => {
              const isSelected = quality === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setQuality(opt.value)}
                  type="button"
                  style={{
                    padding: "10px 18px",
                    fontSize: "0.95rem",
                    borderRadius: "20px",
                    border: "1px solid",
                    borderColor: isSelected
                      ? "var(--primary, #a855f7)"
                      : "rgba(255, 255, 255, 0.1)",
                    background: isSelected
                      ? "var(--primary-transparent, rgba(168, 85, 247, 0.15))"
                      : "rgba(255, 255, 255, 0.03)",
                    color: isSelected ? "var(--primary, #d8b4fe)" : "#e2e8f0",
                    cursor: "pointer",
                    fontWeight: isSelected ? "600" : "500",
                    transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                    whiteSpace: "nowrap",
                    backdropFilter: "blur(4px)",
                  }}
                  onMouseOver={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "rgba(255, 255, 255, 0.08)";
                      (e.currentTarget as HTMLButtonElement).style.borderColor =
                        "rgba(255, 255, 255, 0.2)";
                    }
                  }}
                  onMouseOut={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "rgba(255, 255, 255, 0.03)";
                      (e.currentTarget as HTMLButtonElement).style.borderColor =
                        "rgba(255, 255, 255, 0.1)";
                    }
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            flexShrink: 0,
          }}
        >
          <button
            onClick={handleFullDownload}
            className="btn-primary"
            disabled={downloadStatus !== "idle"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              justifyContent: "center",
              padding: "18px",
              borderRadius: "16px",
              fontSize: "1.05rem",
              fontWeight: "600",
              border: "none",
              background:
                downloadStatus === "success"
                  ? "#22c55e"
                  : "linear-gradient(135deg, var(--primary, #a855f7) 0%, #7e22ce 100%)",
              color: "#fff",
              cursor: "pointer",
              transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
              boxShadow: "0 4px 14px rgba(168, 85, 247, 0.2)",
              opacity: downloadStatus === "idle" ? 1 : 0.92,
            }}
          >
            {downloadStatus === "loading" ? (
              <Loader2 size={22} className="spinning" />
            ) : downloadStatus === "success" ? (
              <Check size={22} />
            ) : (
              <DownloadIcon size={22} />
            )}
            {downloadStatus === "loading"
              ? "Démarrage en cours..."
              : downloadStatus === "success"
                ? "Téléchargement lancé"
                : "Télécharger la vidéo complète"}
          </button>

          <button
            onClick={handleManualClip}
            className="btn-secondary"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              justifyContent: "center",
              padding: "16px",
              borderRadius: "16px",
              fontSize: "1rem",
              fontWeight: "600",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              background: "rgba(255, 255, 255, 0.03)",
              color: "#e2e8f0",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            <Scissors size={20} style={{ opacity: 0.8 }} /> Extraire un clip
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(menu, document.body);
}
