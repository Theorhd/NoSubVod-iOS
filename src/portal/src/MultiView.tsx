import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, X } from "lucide-react";
import NSVPlayer from "./components/NSVPlayer";
import { ExperienceSettings } from "../../shared/types";
import { useResponsive } from "./hooks/useResponsive";
import { normalizeExperienceSettings } from "./utils/experienceSettings";
import { navigateBackInApp } from "./utils/navigation";
import "./styles/MultiView.css";

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

function createSlotId(): string {
  const api = globalThis.crypto;
  if (api?.randomUUID) {
    return api.randomUUID().replaceAll("-", "");
  }
  if (api?.getRandomValues) {
    const bytes = new Uint8Array(10);
    api.getRandomValues(bytes);
    let hex = "";
    for (const byte of bytes) {
      const b = byte.toString(16);
      hex += b.length === 1 ? `0${b}` : b;
    }
    return hex;
  }
  return `${Date.now().toString(36)}-${(globalThis.performance?.now() ?? 0)
    .toString(36)
    .replace(".", "")}`;
}

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
    const id = createSlotId();
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
    <div className="player-container multiview-container">
      <div className="top-bar multiview-top-bar">
        <div className="multiview-header-content">
          <button
            onClick={() => navigateBackInApp(navigate, "/")}
            className="secondary-btn multiview-back-btn"
          >
            <ArrowLeft size={20} />
          </button>
          <h2 className="multiview-title">Multi-View Local</h2>
        </div>

        <div className="multiview-controls">
          <input
            type="text"
            className="search-input multiview-input"
            placeholder="ID (Streamer ou VOD ID)"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <button
            className="action-btn multiview-action-btn"
            onClick={() => addSlot("live", inputValue)}
          >
            + Live
          </button>
          <button
            className="secondary-btn multiview-action-btn"
            onClick={() => addSlot("vod", inputValue)}
          >
            + VOD
          </button>
        </div>
      </div>

      <div
        className="multiview-grid"
        style={{
          gridTemplateColumns: gridColumns,
          gridTemplateRows: slots.length > 2 ? "1fr 1fr" : "1fr",
        }}
      >
        {slots.length === 0 && (
          <div className="multiview-empty-state">
            Ajoutez un flux pour commencer le Multi-View
          </div>
        )}
        {slots.slice(0, 4).map((slot) => (
          <div key={slot.id} className="multiview-slot">
            <NSVPlayer
              source={{
                src: (() => {
                  if (slot.type === "live") {
                    return `/api/live/${encodeURIComponent(slot.targetId)}/master.m3u8`;
                  }

                  const quality = (
                    settings.defaultVideoQuality || "auto"
                  ).trim();
                  const qualityQuery = quality
                    ? `?quality=${encodeURIComponent(quality)}`
                    : "";

                  return `/api/vod/${encodeURIComponent(slot.targetId)}/master.m3u8${qualityQuery}`;
                })(),
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
              className="multiview-remove-btn"
            >
              <X size={16} />
            </button>
            <div className="multiview-slot-title">{slot.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
