import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useServer } from "../../ServerContext";
import { getDeviceId } from "../../utils/authTokens";
import { ExperienceSettings } from "../../../../shared/types";

const LazyQRCodeReader = React.lazy(async () => {
  const module = await import("../QRCodeReader");
  return { default: module.QRCodeReader };
});

function unknownErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Erreur inconnue";
  }
}

const DESKTOP_SERVER_HTTPS_PORT = "23456";

function isDesktopServerOrigin(origin: string): boolean {
  try {
    return new URL(origin).port === DESKTOP_SERVER_HTTPS_PORT;
  } catch {
    return false;
  }
}

const ServerConnectionSection = React.memo(() => {
  const { serverUrl, setServerUrl, token, setToken, removeToken, isOnline } =
    useServer();
  const [scannedServers, setScannedServers] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [pairingPushOverride, setPairingPushOverride] = useState(true);
  const [pairingApnsToken, setPairingApnsToken] = useState("");
  const [pairingSaving, setPairingSaving] = useState(false);

  const desktopServers = useMemo(
    () => scannedServers.filter((server) => isDesktopServerOrigin(server)),
    [scannedServers],
  );

  const persistPairingConfig = useCallback(
    async (
      enabled: boolean,
      origin: string | null,
      sessionToken: string | null,
    ) => {
      const payload = {
        desktopPairingEnabled: enabled,
        desktopPairingServerUrl: enabled ? origin : null,
        desktopPairingServerToken: enabled ? sessionToken : null,
        desktopPairingDeviceId: enabled ? getDeviceId() : null,
        desktopPairingApnsToken: pairingApnsToken.trim() || null,
        desktopPairingPushOverride: pairingPushOverride,
      };

      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
    [pairingApnsToken, pairingPushOverride],
  );

  const registerRemotePairing = useCallback(async () => {
    const deviceId = getDeviceId();
    if (!deviceId) {
      throw new Error("Device ID indisponible pour le pairing.");
    }

    const response = await fetch("/api/pairing/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId,
        platform: "ios",
        apnsToken: pairingApnsToken.trim() || null,
        pushEnabled: pairingPushOverride,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(payload?.error || "Pairing Desktop refuse.");
    }
  }, [pairingApnsToken, pairingPushOverride]);

  const unregisterRemotePairing = useCallback(async () => {
    const deviceId = getDeviceId();
    if (!deviceId) {
      return;
    }

    await fetch("/api/pairing/unregister", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
  }, []);

  useEffect(() => {
    const loadPairingSettings = async () => {
      try {
        const response = await fetch("/api/settings");
        if (!response.ok) {
          return;
        }
        const settings = (await response.json()) as ExperienceSettings;
        setPairingPushOverride(settings.desktopPairingPushOverride !== false);
        setPairingApnsToken(settings.desktopPairingApnsToken || "");
      } catch {
        // Keep defaults if settings cannot be loaded.
      }
    };

    void loadPairingSettings();
  }, []);

  useEffect(() => {
    const enabled = Boolean(serverUrl && token);
    void persistPairingConfig(enabled, serverUrl || null, token || null).catch(
      () => {
        // Ignore autosave failures, connection flow will retry explicit sync.
      },
    );
  }, [
    persistPairingConfig,
    pairingApnsToken,
    pairingPushOverride,
    serverUrl,
    token,
  ]);

  const scanNetwork = async () => {
    setScanning(true);
    setConnectionError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const servers = await invoke<string[]>("scan_local_servers");
      setScannedServers(servers);
    } catch (e) {
      console.error("Scan failed", e);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    // Scan by default on mount
    void scanNetwork();
  }, []);

  const handleQRScan = async (text: string) => {
    try {
      const url = new URL(text);
      if (url.port !== DESKTOP_SERVER_HTTPS_PORT) {
        setConnectionError(
          `Connexion refusee: iOS accepte uniquement les serveurs Desktop sur le port ${DESKTOP_SERVER_HTTPS_PORT}.`,
        );
        return;
      }

      const t = url.searchParams.get("t");
      if (t) {
        setPairingSaving(true);
        url.searchParams.delete("t");
        setServerUrl(url.origin);
        setToken(t);

        try {
          await persistPairingConfig(true, url.origin, t);
          await registerRemotePairing();
          setShowQRScanner(false);
          setSelectedServer(null);
          setConnectionError("");
        } catch (error) {
          setConnectionError(unknownErrorMessage(error));
        } finally {
          setPairingSaving(false);
        }
      } else {
        setConnectionError("Le QR code ne contient pas de token de connexion.");
        console.error("No token found in QR code:", text);
      }
    } catch (e) {
      console.error("QR Code parse error:", e);
      setConnectionError("QR code invalide.");
    }
  };

  return (
    <div className="card settings-card">
      <div className="settings-header-row">
        <h2>Serveur local (NoSubVod Desktop)</h2>
        <div className="settings-flex-gap-10">
          <button
            className="action-btn settings-mini-btn"
            onClick={scanNetwork}
            disabled={scanning}
          >
            {scanning ? "Scan en cours..." : "Re-scanner"}
          </button>

          {serverUrl && token && (
            <div
              className={`settings-status-badge ${isOnline ? "settings-status-online" : "settings-status-offline"}`}
            >
              {isOnline ? "Connecté" : "Déconnecté"}
            </div>
          )}
        </div>
      </div>

      <p className="settings-description settings-margin-bottom-16">
        {serverUrl && token
          ? `Actuellement lié à : ${serverUrl}`
          : "Connectez l'application Mobile à votre instance Desktop en la sélectionnant ci-dessous."}
      </p>

      {serverUrl && token && (
        <>
          <div className="settings-config-box">
            <label className="settings-label" htmlFor="pairing-apns-token">
              Token APNs iPhone (optionnel)
            </label>
            <input
              id="pairing-apns-token"
              type="password"
              className="search-input settings-input-with-box-sizing"
              placeholder="Coller le token APNs si disponible"
              value={pairingApnsToken}
              onChange={(event) => {
                setPairingApnsToken(event.target.value);
                setConnectionError("");
              }}
            />

            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={pairingPushOverride}
                onChange={(event) => {
                  setPairingPushOverride(event.target.checked);
                  setConnectionError("");
                }}
              />
              <span>
                Prioriser le push APNs distant si le serveur Desktop est pairé
              </span>
            </label>

            <button
              className="action-btn settings-margin-top-10 settings-input-full"
              disabled={pairingSaving}
              onClick={async () => {
                if (!serverUrl || !token) {
                  return;
                }

                setPairingSaving(true);
                setConnectionError("");

                try {
                  await persistPairingConfig(true, serverUrl, token);
                  await registerRemotePairing();
                } catch (error) {
                  setConnectionError(unknownErrorMessage(error));
                } finally {
                  setPairingSaving(false);
                }
              }}
            >
              {pairingSaving
                ? "Synchronisation..."
                : "Synchroniser Pairing + Push APNs"}
            </button>
          </div>

          <button
            className="action-btn disconnect-btn"
            disabled={pairingSaving}
            onClick={async () => {
              setPairingSaving(true);
              setConnectionError("");

              try {
                await unregisterRemotePairing();
              } catch {
                // Continue disconnect even if remote unregister fails.
              }

              removeToken();
              setServerUrl("");

              try {
                await persistPairingConfig(false, null, null);
              } catch {
                // Ignore local sync errors while disconnecting.
              }

              setConnectionError("");
              setPairingSaving(false);
            }}
          >
            Déconnecter et repasser en mode Standalone
          </button>
        </>
      )}

      {connectionError && (
        <div className="error-text settings-margin-bottom-16">
          {connectionError}
        </div>
      )}

      {desktopServers.length === 0 && !scanning && (!serverUrl || !token) && (
        <div className="qr-reader-wrapper">
          <p className="settings-text-muted-small">
            Aucun Serveur NoSubVod Desktop n&apos;a été détecté
          </p>
        </div>
      )}

      {desktopServers.length > 0 && (!serverUrl || !token) && (
        <div className="server-list-container">
          <h3 style={{ margin: "0 0 8px 0", fontSize: "1rem" }}>
            Serveurs découverts :
          </h3>
          {desktopServers.map((s) => (
            <div
              key={s}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px",
                background: "rgba(255,255,255,0.05)",
                borderRadius: "8px",
              }}
            >
              <span>{s}</span>
              <button
                className="action-btn"
                onClick={() => {
                  setSelectedServer(s);
                  setShowQRScanner(false);
                  setConnectionError("");
                }}
              >
                Connect
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedServer && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.8)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "#18181b",
              padding: "24px",
              borderRadius: "12px",
              width: "100%",
              maxWidth: "400px",
            }}
          >
            <h3 style={{ marginTop: 0 }}>Connexion à {selectedServer}</h3>

            <button
              className="action-btn"
              style={{ width: "100%", marginBottom: "16px" }}
              onClick={() => setShowQRScanner(true)}
            >
              Scanner le QR Code
            </button>

            <div
              style={{
                textAlign: "center",
                margin: "16px 0",
                color: "#a3a3a3",
              }}
            >
              OU
            </div>

            <input
              type="password"
              className="search-input"
              placeholder="Entrer le token manuellement"
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              style={{
                width: "100%",
                marginBottom: "16px",
                boxSizing: "border-box",
              }}
            />

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                className="action-btn"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "1px solid #333",
                }}
                onClick={() => setSelectedServer(null)}
              >
                Annuler
              </button>
              <button
                className="action-btn"
                style={{ flex: 1 }}
                onClick={async () => {
                  if (
                    !selectedServer ||
                    !isDesktopServerOrigin(selectedServer)
                  ) {
                    setConnectionError(
                      `Connexion refusee: seul un serveur Desktop sur le port ${DESKTOP_SERVER_HTTPS_PORT} est accepte.`,
                    );
                    return;
                  }
                  if (manualToken.trim()) {
                    const normalizedToken = manualToken.trim();
                    setPairingSaving(true);
                    setServerUrl(selectedServer);
                    setToken(normalizedToken);

                    try {
                      await persistPairingConfig(
                        true,
                        selectedServer,
                        normalizedToken,
                      );
                      await registerRemotePairing();
                      setSelectedServer(null);
                      setConnectionError("");
                    } catch (error) {
                      setConnectionError(unknownErrorMessage(error));
                    } finally {
                      setPairingSaving(false);
                    }
                  } else {
                    setConnectionError(
                      "Veuillez entrer un token de connexion.",
                    );
                  }
                }}
              >
                Valider
              </button>
            </div>
          </div>
        </div>
      )}

      {showQRScanner && (
        <React.Suspense
          fallback={
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0,0,0,0.8)",
                zIndex: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#a3a3a3",
                fontSize: "14px",
              }}
            >
              Chargement du scanner...
            </div>
          }
        >
          <LazyQRCodeReader
            onScan={handleQRScan}
            onClose={() => setShowQRScanner(false)}
          />
        </React.Suspense>
      )}
    </div>
  );
});
ServerConnectionSection.displayName = "ServerConnectionSection";

export { ServerConnectionSection };
