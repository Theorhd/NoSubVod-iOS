import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopBar } from "./components/TopBar";
import { useServer } from "./ServerContext";

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
          <div className="card" style={{ maxWidth: 760, margin: "0 auto" }}>
            <h2 style={{ marginTop: 0 }}>Screen Share indisponible</h2>
            <p className="card-subtitle" style={{ marginBottom: 16 }}>
              Connectez d&apos;abord l&apos;application iOS a un serveur
              NoSubVod-Desktop depuis les Settings.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="action-btn"
                onClick={() => navigate("/settings")}
              >
                Ouvrir les Settings
              </button>
              <button
                className="secondary-btn"
                onClick={() => navigate("/")}
              >
                Back to Home
              </button>
            </div>
          </div>
        )}

        {isDesktopConnected && (
        <div className="card" style={{ maxWidth: 760, margin: "0 auto" }}>
          <h2 style={{ marginTop: 0 }}>Join Screen Share (Viewer)</h2>
          <p className="card-subtitle" style={{ marginBottom: 16 }}>
            iOS can receive NSV-Desktop screen shares but cannot broadcast its
            own screen.
          </p>
          <p style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
            Le serveur Desktop lie dans les Settings est utilise
            automatiquement. Si l&apos;hote vous a donne un session ID, vous pouvez
            le renseigner ci-dessous.
          </p>

          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            <label
              htmlFor="session-id"
              style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}
            >
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

          <div
            style={{
              marginTop: 20,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
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
