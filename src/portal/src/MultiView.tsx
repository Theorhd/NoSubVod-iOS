import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, X } from "lucide-react";
import NSVPlayer from "./components/NSVPlayer";
import { ExperienceSettings } from "../../shared/types";
import { useResponsive } from "./hooks/useResponsive";
import { normalizeExperienceSettings } from "./utils/experienceSettings";

interface MultiPlayerSlot {
  id: string;
  type: "live" | "vod";
  targetId: string;
  title: string;
}

const DEFAULT_SETTINGS: ExperienceSettings = {
  oneSync: false,
  defaultVideoQuality: "auto",
};

export default function MultiView() {
  const navigate = useNavigate();
  const { isMobileLayout } = useResponsive();
  const [slots, setSlots] = useState<MultiPlayerSlot[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [settings, setSettings] =
    useState<ExperienceSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data)
          setSettings((prev) => ({
            ...prev,
            ...normalizeExperienceSettings(data),
          }));
      })
      .catch(console.error);
  }, []);

  const addSlot = (type: "live" | "vod", targetId: string) => {
    if (!targetId.trim()) return;
    const id = Math.random().toString(36).substring(7);
    setSlots((prev) => [
      ...prev,
      {
        id,
        type,
        targetId: targetId.trim(),
        title: `${type.toUpperCase()}: ${targetId}`,
      },
    ]);
    setInputValue("");
  };

  const removeSlot = (id: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== id));
  };

  const gridColumns = slots.length >= 2 ? "1fr 1fr" : "1fr";

  return (
    <div
      className="player-container"
      style={{ display: "flex", flexDirection: "column" }}
    >
      <div
        className="top-bar"
        style={{
          position: "relative",
          zIndex: 10,
          background: "rgba(7, 8, 15, 0.8)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            flex: 1,
          }}
        >
          <button
            onClick={() => navigate(-1)}
            className="secondary-btn"
            style={{
              width: "40px",
              height: "40px",
              padding: 0,
              borderRadius: "50%",
            }}
          >
            <ArrowLeft size={20} />
          </button>
          <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: 0 }}>
            Multi-View Local
          </h2>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            type="text"
            className="search-input"
            placeholder="ID (Streamer ou VOD ID)"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            style={{ width: "180px", margin: 0, height: "36px" }}
          />
          <button
            className="action-btn"
            style={{ padding: "0 12px", height: "36px", fontSize: "0.8rem" }}
            onClick={() => addSlot("live", inputValue)}
          >
            + Live
          </button>
          <button
            className="secondary-btn"
            style={{ padding: "0 12px", height: "36px", fontSize: "0.8rem" }}
            onClick={() => addSlot("vod", inputValue)}
          >
            + VOD
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: gridColumns,
          gridTemplateRows: slots.length > 2 ? "1fr 1fr" : "1fr",
          gap: "2px",
          background: "#111",
          padding: "2px",
          overflow: "hidden",
        }}
      >
        {slots.length === 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
              fontSize: "1.2rem",
              gridColumn: "1 / -1",
            }}
          >
            Ajoutez un flux pour commencer le Multi-View
          </div>
        )}
        {slots.slice(0, 4).map((slot) => (
          <div
            key={slot.id}
            style={{
              position: "relative",
              background: "#000",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <NSVPlayer
              source={{
                src:
                  slot.type === "live"
                    ? `/api/live/${encodeURIComponent(slot.targetId)}/master.m3u8`
                    : `/api/vod/${slot.targetId}/master.m3u8`,
                type: "application/x-mpegurl",
              }}
              streamType={slot.type === "live" ? "live" : "on-demand"}
              title={slot.title}
              defaultQuality={settings.defaultVideoQuality}
              isMobileLayout={isMobileLayout}
              autoPlay
              muted
              className="nsv-main-player"
            />
            <button
              onClick={() => removeSlot(slot.id)}
              style={{
                position: "absolute",
                top: "10px",
                right: "10px",
                zIndex: 100,
                background: "rgba(0,0,0,0.6)",
                border: "none",
                color: "white",
                width: "30px",
                height: "30px",
                borderRadius: "50%",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={16} />
            </button>
            <div
              style={{
                position: "absolute",
                bottom: "40px",
                left: "10px",
                zIndex: 50,
                background: "rgba(0,0,0,0.6)",
                padding: "4px 8px",
                borderRadius: "4px",
                fontSize: "0.75rem",
                color: "white",
                pointerEvents: "none",
              }}
            >
              {slot.title}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
