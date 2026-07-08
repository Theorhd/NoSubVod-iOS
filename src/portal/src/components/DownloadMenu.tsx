import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import {
  Download as DownloadIcon,
  Scissors,
  X,
  Loader2,
  Check,
  ChevronRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { navigateToPlayer } from "../utils/navigation";
import { buildAuthSuffix } from "../utils/authTokens";

interface DownloadMenuProps {
  vodId: string;
  title?: string;
  duration?: number;
  onClose: () => void;
  anchorRect?: DOMRect | null;
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
    "idle" | "loading" | "success" | "error"
  >("idle");

  const navigate = useNavigate();

  useEffect(() => {
    requestAnimationFrame(() => setIsMounted(true));
    // Prevent background scrolling on iOS when sheet is open
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 400);
  };

  const handleFullDownload = async () => {
    if (downloadStatus !== "idle" && downloadStatus !== "error") return;
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
      setDownloadStatus("error");
      setTimeout(() => setDownloadStatus("idle"), 3000);
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

  return ReactDOM.createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        zIndex: 99999,
        opacity: isVisible ? 1 : 0,
        transition: "opacity 0.4s cubic-bezier(0.32, 0.72, 0, 1)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: "env(safe-area-inset-bottom, 24px)",
        paddingLeft: "16px",
        paddingRight: "16px",
        touchAction: "none", // Prevent scrolling on the overlay itself
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      {/* CSS for touch states and animations since inline pseudo-classes are tricky */}
      <style>{`
        .ios-btn {
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s ease, opacity 0.2s ease;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        .ios-btn:active {
          transform: scale(0.96);
        }
        .quality-btn {
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .quality-btn:active {
          transform: scale(0.92);
        }
        .dl-sheet {
          transition: transform 0.4s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.4s ease;
        }
      `}</style>

      <div
        className="dl-sheet"
        style={{
          width: "100%",
          maxWidth: "500px",
          background: "rgba(24, 24, 28, 0.95)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "32px",
          padding: "28px 24px 32px",
          display: "flex",
          flexDirection: "column",
          transform: isVisible
            ? "translateY(0) scale(1)"
            : "translateY(40px) scale(0.95)",
          boxShadow:
            "0 24px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)",
          marginBottom: "16px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "32px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <h3
              style={{
                margin: 0,
                fontSize: "1.6rem",
                fontWeight: "800",
                letterSpacing: "-0.03em",
                color: "#fff",
              }}
            >
              Télécharger
            </h3>
            {title && (
              <span
                style={{
                  fontSize: "0.85rem",
                  color: "rgba(255, 255, 255, 0.5)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "250px",
                }}
              >
                {title}
              </span>
            )}
          </div>

          <button
            className="ios-btn"
            onClick={handleClose}
            style={{
              background: "rgba(255, 255, 255, 0.08)",
              border: "none",
              color: "#fff",
              cursor: "pointer",
              borderRadius: "50%",
              width: "44px",
              height: "44px", // Minimum touch target size for iOS
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ marginBottom: "40px" }}>
          <span
            style={{
              display: "block",
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              marginBottom: "16px",
              color: "rgba(255, 255, 255, 0.4)",
              fontWeight: "700",
            }}
          >
            Sélectionner la qualité
          </span>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
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
                  className="quality-btn"
                  onClick={() => setQuality(opt.value)}
                  type="button"
                  style={{
                    padding: "12px 20px",
                    fontSize: "0.95rem",
                    borderRadius: "24px",
                    border: "1px solid",
                    borderColor: isSelected
                      ? "var(--primary, #a855f7)"
                      : "rgba(255, 255, 255, 0.08)",
                    background: isSelected
                      ? "var(--primary, #a855f7)"
                      : "rgba(255, 255, 255, 0.04)",
                    color: isSelected ? "#fff" : "rgba(255, 255, 255, 0.8)",
                    cursor: "pointer",
                    fontWeight: isSelected ? "700" : "500",
                    boxShadow: isSelected
                      ? "0 8px 16px rgba(168, 85, 247, 0.25)"
                      : "none",
                    touchAction: "manipulation",
                    WebkitTapHighlightColor: "transparent",
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
            gap: "16px",
            flexShrink: 0,
          }}
        >
          <button
            onClick={handleFullDownload}
            disabled={
              downloadStatus === "loading" || downloadStatus === "success"
            }
            className="ios-btn"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              justifyContent: "center",
              padding: "20px",
              borderRadius: "20px",
              fontSize: "1.1rem",
              fontWeight: "700",
              border: "none",
              background:
                downloadStatus === "success"
                  ? "#10b981"
                  : downloadStatus === "error"
                    ? "#ef4444"
                    : "var(--primary, #a855f7)",
              color: "#fff",
              cursor: "pointer",
              boxShadow:
                downloadStatus === "idle"
                  ? "0 8px 24px rgba(168, 85, 247, 0.3)"
                  : "none",
              opacity:
                downloadStatus === "loading" || downloadStatus === "success"
                  ? 0.9
                  : 1,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {downloadStatus === "loading" ? (
              <Loader2 size={24} className="spinning" />
            ) : downloadStatus === "success" ? (
              <Check size={24} />
            ) : downloadStatus === "error" ? (
              <X size={24} />
            ) : (
              <DownloadIcon size={24} />
            )}

            <span>
              {downloadStatus === "loading"
                ? "Démarrage..."
                : downloadStatus === "success"
                  ? "Téléchargement lancé"
                  : downloadStatus === "error"
                    ? "Erreur - Réessayer"
                    : "Télécharger la vidéo complète"}
            </span>
          </button>

          <button
            onClick={handleManualClip}
            className="ios-btn"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "20px 24px",
              borderRadius: "20px",
              fontSize: "1.05rem",
              fontWeight: "600",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              background: "rgba(255, 255, 255, 0.03)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.1)",
                  padding: "8px",
                  borderRadius: "50%",
                  display: "flex",
                }}
              >
                <Scissors size={20} />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: "2px",
                }}
              >
                <span>Extraire un clip</span>
                <span
                  style={{
                    fontSize: "0.8rem",
                    color: "rgba(255, 255, 255, 0.4)",
                    fontWeight: "500",
                  }}
                >
                  Télécharger un extrait précis
                </span>
              </div>
            </div>
            <ChevronRight
              size={20}
              style={{ color: "rgba(255, 255, 255, 0.3)" }}
            />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
