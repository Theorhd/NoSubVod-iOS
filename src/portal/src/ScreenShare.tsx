import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopBar } from "./components/TopBar";
import { useServer } from "./ServerContext";
import "./styles/ScreenShare.css";

const RELAY_STORAGE_KEY = "nsv_remote_relay_origin";

export default function ScreenShare() {
  const navigate = useNavigate();
  const { isConnected, serverUrl } = useServer();
  const [sessionId, setSessionId] = useState("");
  const isDesktopConnected = isConnected && Boolean(serverUrl);

  const viewerUrl = useMemo(() => {
    const id = sessionId.trim();
    const query = new URLSearchParams({ screenshare: "1" });
    if (id) query.set("sessionId", id);
    if (serverUrl) query.set("relay", serverUrl);
    return `/player?${query.toString()}`;
  }, [sessionId, serverUrl]);

  const openViewer = () => {
    if (!isDesktopConnected || !serverUrl) {
      navigate("/settings");
      return;
    }

    globalThis.localStorage.setItem(RELAY_STORAGE_KEY, serverUrl);
    navigate(viewerUrl);
  };

  return (
    <>
      <TopBar
        mode="logo"
        title="Screen Share"
        onLogoClick={() => navigate("/")}
      />
      <div className="container">
        {!isDesktopConnected && (
          <div className="card screenshare-card">
            <h2 className="screenshare-title">Screen Share indisponible</h2>
            <p className="card-subtitle screenshare-subtitle">
              Connectez d&apos;abord l&apos;application iOS a un serveur
              NoSubVod-Desktop depuis les Settings.
            </p>
            <div className="screenshare-actions">
              <button
                className="action-btn"
                onClick={() => navigate("/settings")}
              >
                Ouvrir les Settings
              </button>
              <button className="secondary-btn" onClick={() => navigate("/")}>
                Back to Home
              </button>
            </div>
          </div>
        )}

        {isDesktopConnected && (
          <div className="card screenshare-card">
            <h2 className="screenshare-title">Join Screen Share (Viewer)</h2>
            <p className="card-subtitle screenshare-subtitle">
              iOS can receive NSV-Desktop screen shares but cannot broadcast its
              own screen.
            </p>
            <p className="screenshare-text">
              Le serveur Desktop lie dans les Settings est utilise
              automatiquement. Si l&apos;hote vous a donne un session ID, vous
              pouvez le renseigner ci-dessous.
            </p>

            <div className="screenshare-input-group">
              <label htmlFor="session-id" className="screenshare-label">
                Session ID
              </label>
              <input
                id="session-id"
                type="text"
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                className="search-input"
                placeholder="Optional: paste session id"
              />
            </div>

            <div className="screenshare-footer">
              <button className="action-btn" onClick={openViewer}>
                Open Viewer
              </button>
              <button className="secondary-btn" onClick={() => navigate("/")}>
                Back to Home
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
