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
    }, 300); // Matches the CSS transition duration
  };

  const handleFullDownload = async () => {
    if (downloadStatus !== "idle") return;
    setDownloadStatus("loading");
    try {
      const res = await fetch("/api/download/start", {
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
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    zIndex: 99999,
    opacity: isVisible ? 1 : 0,
    transition: "opacity 0.3s ease",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
  };

  const sheetStyle: React.CSSProperties = {
    maxHeight: "70vh",
    background: "var(--bg-elevated)",
    borderTopLeftRadius: "24px",
    borderTopRightRadius: "24px",
    padding: "0 20px 20px 20px",
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    transform: isVisible ? "translateY(0)" : "translateY(100%)",
    transition: "transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)",
    boxShadow: "0 -8px 24px rgba(0,0,0,0.4)",
  };

  const dragHandleStyle: React.CSSProperties = {
    width: "40px",
    height: "5px",
    backgroundColor: "var(--surface-soft)",
    borderRadius: "10px",
    margin: "12px auto 20px auto",
  };

  const menu = (
    <div
      style={overlayStyle}
      onClick={(e) => {
        // Close if clicking on the overlay background
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div style={sheetStyle} onClick={(e) => e.stopPropagation()}>
        <div style={dragHandleStyle} />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "24px",
          }}
        >
          <h3 style={{ margin: 0, fontSize: "1.3rem", fontWeight: "600" }}>
            Télécharger la VOD
          </h3>
          <button
            onClick={handleClose}
            style={{
              background: "var(--surface)",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              borderRadius: "50%",
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.2s ease",
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ marginBottom: "32px" }}>
          <span
            style={{
              display: "block",
              fontSize: "0.95rem",
              marginBottom: "12px",
              color: "var(--text-muted)",
              fontWeight: "500",
            }}
          >
            Qualité vidéo
          </span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "8px",
              flexShrink: 0,
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
                    padding: "12px 4px",
                    fontSize: "0.9rem",
                    borderRadius: "10px",
                    border: "2px solid",
                    borderColor: isSelected ? "var(--primary)" : "transparent",
                    background: isSelected
                      ? "var(--primary-transparent, rgba(147, 51, 234, 0.15))" // fallback if var doesn't exist
                      : "var(--surface)",
                    color: isSelected ? "var(--primary)" : "var(--text)",
                    cursor: "pointer",
                    fontWeight: isSelected ? "600" : "500",
                    transition: "all 0.2s ease",
                    textAlign: "center",
                    whiteSpace: "nowrap",
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
            gap: "12px",
            flexShrink: 0,
            paddingTop: "8px",
            paddingBottom: "env(safe-area-inset-bottom, 20px)",
          }}
        >
          <style>{`
            @keyframes spin-menu { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .spin-menu-icon { animation: spin-menu 1s linear infinite; }
          `}</style>
          <button
            onClick={handleFullDownload}
            className="action-btn"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              justifyContent: "center",
              padding: "16px",
              borderRadius: "12px",
              fontSize: "1rem",
              fontWeight: "600",
              background:
                downloadStatus === "success"
                  ? "var(--success, #22c55e)"
                  : undefined,
              color: downloadStatus === "success" ? "white" : undefined,
              transition: "all 0.3s ease",
            }}
          >
            {downloadStatus === "loading" ? (
              <Loader2 size={20} className="spin-menu-icon" />
            ) : downloadStatus === "success" ? (
              <Check size={20} />
            ) : (
              <DownloadIcon size={20} />
            )}
            {downloadStatus === "loading"
              ? "Lancement..."
              : downloadStatus === "success"
                ? "Téléchargement lancé"
                : "VOD Entière"}
          </button>
          <button
            onClick={handleManualClip}
            className="action-btn secondary-btn"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              justifyContent: "center",
              padding: "16px",
              borderRadius: "12px",
              fontSize: "1rem",
              fontWeight: "600",
            }}
          >
            <Scissors size={20} /> Sélectionner une partie
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(menu, document.body);
}
