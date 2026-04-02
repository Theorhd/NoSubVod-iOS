import React, { useState } from "react";
import ReactDOM from "react-dom";
import { Download as DownloadIcon, Scissors, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface DownloadMenuProps {
  vodId: string;
  title?: string;
  duration?: number;
  onClose: () => void;
  /** When provided the menu renders in a portal at a fixed position (escapes overflow:hidden). */
  anchorRect?: DOMRect | null;
}

export default function DownloadMenu({
  vodId,
  title,
  duration,
  onClose,
  anchorRect,
}: DownloadMenuProps) {
  const [quality, setQuality] = useState("best");
  const navigate = useNavigate();

  // Position: portal + fixed when anchorRect is given (escapes overflow:hidden parents),
  // otherwise absolute for in-flow parents.
  const positionStyle: React.CSSProperties = anchorRect
    ? {
        position: "fixed",
        top: anchorRect.bottom + 8,
        right: window.innerWidth - anchorRect.right,
        zIndex: 9999,
      }
    : {
        position: "absolute",
        top: "100%",
        right: "0",
        zIndex: 50,
      };

  const handleFullDownload = async () => {
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
        alert("Téléchargement lancé en arrière-plan !");
      } else {
        throw new Error("Failed to start download");
      }
      onClose();
    } catch (e) {
      alert("Erreur: " + e);
    }
  };

  const handleManualClip = () => {
    // Navigate to player with a special parameter
    navigate(`/player?vod=${vodId}&downloadMode=true`);
    onClose();
  };

  const menu = (
    <div
      style={{
        ...positionStyle,
        background: "var(--bg-elevated)",
        border: "1px solid var(--surface-soft)",
        borderRadius: "8px",
        padding: "16px",
        minWidth: "250px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Télécharger</h3>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          <X size={20} />
        </button>
      </div>

      <div style={{ marginBottom: "16px" }}>
        <label
          htmlFor="quality-select"
          style={{ display: "block", fontSize: "0.9rem", marginBottom: "8px" }}
        >
          Qualité :
        </label>
        <select
          id="quality-select"
          value={quality}
          onChange={(e) => setQuality(e.target.value)}
          style={{
            width: "100%",
            padding: "8px",
            borderRadius: "4px",
            background: "var(--bg)",
            color: "var(--text)",
            border: "1px solid var(--surface-soft)",
          }}
        >
          <option value="best">Best (Source)</option>
          <option value="1080p">1080p</option>
          <option value="720p">720p</option>
          <option value="480p">480p</option>
        </select>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <button
          onClick={handleFullDownload}
          className="action-btn"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            justifyContent: "center",
          }}
        >
          <DownloadIcon size={16} /> VOD Entière
        </button>
        <button
          onClick={handleManualClip}
          className="action-btn secondary-btn"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            justifyContent: "center",
          }}
        >
          <Scissors size={16} /> Sélectionner une partie
        </button>
      </div>
    </div>
  );

  // When anchorRect is given (thumbnail cards with overflow:hidden), render via portal
  // so the menu escapes any clipping parent.
  return anchorRect ? ReactDOM.createPortal(menu, document.body) : menu;
}
