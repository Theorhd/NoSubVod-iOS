import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  ExperienceSettings,
  ProxyInfo,
  TrustedDevice,
  TwitchStatus,
} from "../../shared/types";
import { TopBar } from "./components/TopBar";
import { normalizeExperienceSettings } from "./utils/experienceSettings";
import { useServer } from "./ServerContext";
import { getDeviceId } from "./utils/authTokens";
import { useInterval } from "../../shared/hooks/useInterval";
import { usePageVisibility } from "../../shared/hooks/usePageVisibility";
import { isMobileDevice } from "./utils/capabilities";

const defaultSettings: ExperienceSettings = {
  oneSync: false,
  adblockEnabled: false,
  adblockProxy: "",
  adblockProxyMode: "auto",
  defaultVideoQuality: "auto",
  desktopPairingEnabled: false,
  desktopPairingPushOverride: true,
  desktopPairingApnsToken: "",
  launchAtLogin: false,
  enabledExtensions: [],
};

const LazyQRCodeReader = React.lazy(async () => {
  const module = await import("./components/QRCodeReader");
  return { default: module.QRCodeReader };
});

function isTauriRuntime(): boolean {
  const runtime = globalThis as {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return Boolean(runtime.__TAURI_INTERNALS__ || runtime.__TAURI__);
}

function buildFallbackProfileFilename(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `nosubvod-profile-${yyyy}${mm}${dd}-${hh}${min}.json`;
}

function buildFallbackDiagnosticsFilename(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `nosubvod-diagnostics-backend-${yyyy}${mm}${dd}-${hh}${min}.log`;
}

function buildFallbackFrontendDiagnosticsFilename(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `nosubvod-diagnostics-frontend-${yyyy}${mm}${dd}-${hh}${min}.json`;
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

type FrontendLoggerRuntime = {
  __NSV_LOGGER__?: {
    exportLogs?: (reason?: string) => unknown;
  };
};

function parseFilenameFromDisposition(
  disposition: string | null,
): string | null {
  if (!disposition) {
    return null;
  }

  const utf8FilenamePattern = /filename\*=UTF-8''([^;]+)/i;
  const utf8Match = utf8FilenamePattern.exec(disposition);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }

  const basicFilenamePattern = /filename="?([^";]+)"?/i;
  const basicMatch = basicFilenamePattern.exec(disposition);
  if (basicMatch?.[1]) {
    return basicMatch[1].trim();
  }

  return null;
}

const TWITCH_AUTH_HOSTNAME = "id.twitch.tv";

async function extractErrorMessageFromResponse(
  response: Response,
): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || "";
  } catch {
    return "";
  }
}

function normalizeTwitchAuthUrl(rawAuthUrl: string): string {
  const authUrl = rawAuthUrl.trim();
  if (!authUrl) {
    throw new Error("URL OAuth Twitch invalide.");
  }

  let parsedAuthUrl: URL;
  try {
    parsedAuthUrl = new URL(authUrl);
  } catch {
    throw new Error("URL OAuth Twitch invalide.");
  }

  if (
    parsedAuthUrl.protocol !== "https:" ||
    parsedAuthUrl.hostname !== TWITCH_AUTH_HOSTNAME
  ) {
    throw new Error("URL OAuth Twitch inattendue.");
  }

  return authUrl;
}

function resolveTwitchAuthPlatformHint(): string | null {
  if (isTauriRuntime() && isMobileDevice()) {
    return "ios";
  }
  return null;
}

async function fetchTwitchAuthUrl(
  platformHint: string | null,
): Promise<string> {
  const search = platformHint
    ? `?platform=${encodeURIComponent(platformHint)}`
    : "";
  const startRes = await fetch(`/api/auth/twitch/start${search}`);
  if (!startRes.ok) {
    const backendError = await extractErrorMessageFromResponse(startRes);
    throw new Error(
      backendError ||
        "Impossible de démarrer l'authentification Twitch. Vérifie la configuration OAuth.",
    );
  }

  const startPayload = (await startRes.json()) as { authUrl?: string };
  return normalizeTwitchAuthUrl(startPayload.authUrl || "");
}

type TwitchLaunchResult = "opened" | "redirected";

async function openTwitchAuthFlow(
  authUrl: string,
  popup: Window | null,
): Promise<TwitchLaunchResult> {
  if (popup && !popup.closed) {
    popup.location.href = authUrl;
    return "opened";
  }

  const popupDirect = globalThis.open(authUrl, "_blank", "noopener,noreferrer");
  if (popupDirect && !popupDirect.closed) {
    return "opened";
  }

  globalThis.location.assign(authUrl);
  return "redirected";
}

function unknownErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Erreur inconnue";
  }
}

interface SectionProps {
  readonly settings: ExperienceSettings;
  readonly setSettings: React.Dispatch<
    React.SetStateAction<ExperienceSettings>
  >;
  readonly setSuccess: (val: string) => void;
}

const VideoPlayerSection = React.memo(
  ({ settings, setSettings, setSuccess }: SectionProps) => (
    <div className="card settings-card">
      <h2>Video Player</h2>
      <p className="settings-description">
        Configure la qualité demandée au démarrage. Le changement de qualité
        reste manuel dans le player.
      </p>

      <div className="settings-group">
        <label htmlFor="defaultVideoQuality" className="settings-label">
          Qualité Par Défaut
        </label>
        <select
          id="defaultVideoQuality"
          className="settings-select"
          value={settings.defaultVideoQuality || "auto"}
          onChange={(e) => {
            setSettings((prev) => ({
              ...prev,
              defaultVideoQuality: e.target.value,
            }));
            setSuccess("");
          }}
        >
          <option value="auto">Automatique</option>
          <option value="source">Source (chunked)</option>
          <option value="480">480p</option>
          <option value="720">720p</option>
          <option value="1080">1080p</option>
        </select>
        <small className="help-text">
          Source (chunked) force la meilleure qualité disponible. En
          1080p/720p/480p, le player utilise cette valeur comme qualité maximale
          avec fallback automatique pour plus de stabilité. En auto, il adapte
          dynamiquement.
        </small>
      </div>
    </div>
  ),
);
VideoPlayerSection.displayName = "VideoPlayerSection";

const AdblockSection = React.memo(
  ({
    settings,
    setSettings,
    setSuccess,
    proxies,
    activeProxy,
  }: SectionProps & {
    proxies: ProxyInfo[];
    activeProxy: ProxyInfo | null;
  }) => {
    const getProxyStatusClass = (status?: string) => {
      if (status === "success") return " status-success";
      if (status === "error") return " status-error";
      return "";
    };

    return (
      <div className="card settings-card">
        <h2>Adblock Proxies</h2>
        <p className="settings-description">
          Utilise un proxy tiers pour contourner les pubs Twitch sur les lives
          et les VODs.
        </p>

        <div className="toggle-row">
          <span>
            <strong>
              <label htmlFor="adblockEnabled" className="mb-0">
                Activer le Proxy Adblock
              </label>
            </strong>
            <small>
              Désactivé par défaut. Activez-le si vous avez trop de pubs.
            </small>
          </span>
          <input
            id="adblockEnabled"
            type="checkbox"
            checked={settings.adblockEnabled}
            onChange={(e) => {
              setSettings((prev) => ({
                ...prev,
                adblockEnabled: e.target.checked,
              }));
              setSuccess("");
            }}
          />
        </div>

        {settings.adblockEnabled && (
          <>
            <div className="settings-group mt-2">
              <label htmlFor="adblockProxyMode" className="settings-label">
                Mode de Sélection du Proxy
              </label>
              <select
                id="adblockProxyMode"
                className="settings-select"
                value={settings.adblockProxyMode || "auto"}
                onChange={(e) => {
                  setSettings((prev) => ({
                    ...prev,
                    adblockProxyMode: e.target.value as any,
                  }));
                  setSuccess("");
                }}
              >
                <option value="auto">Automatique (recommandé)</option>
                <option value="manual">Manuel</option>
              </select>
            </div>

            {settings.adblockProxyMode === "manual" && (
              <div className="settings-group mt-2">
                <label htmlFor="adblockProxy" className="settings-label">
                  Proxy Manuel
                </label>
                <select
                  id="adblockProxy"
                  className="settings-select"
                  value={settings.adblockProxy || ""}
                  onChange={(e) => {
                    setSettings((prev) => ({
                      ...prev,
                      adblockProxy: e.target.value,
                    }));
                    setSuccess("");
                  }}
                >
                  <option value="" disabled>
                    Sélectionnez un proxy
                  </option>
                  {proxies.map((p) => (
                    <option key={p.url} value={p.url}>
                      {p.url} ({p.country})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {activeProxy && (
              <div className="settings-active-proxy">
                <strong className="settings-active-proxy-title">
                  Proxy Actif :
                </strong>
                <div className="settings-active-proxy-row">
                  <span
                    className={`settings-active-proxy-dot${getProxyStatusClass((activeProxy as any).status)}`}
                  />
                  <span className="settings-active-proxy-name">
                    {activeProxy.url}
                  </span>
                </div>
                {activeProxy.ping !== undefined && (
                  <div className="settings-active-proxy-meta">
                    Ping: {activeProxy.ping}ms
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  },
);
AdblockSection.displayName = "AdblockSection";

const DownloadsSection = React.memo(
  ({
    settings,
    setSettings,
    setSuccess,
    selectFolder,
  }: SectionProps & { selectFolder: (field: any) => Promise<void> }) => (
    <div className="card settings-card">
      <h2>Downloads (Server Backend)</h2>
      <p className="settings-description">Où stocker les VODs téléchargées.</p>

      <div className="settings-group">
        <label htmlFor="downloadLocalPath" className="settings-label">
          Chemin Local
        </label>
        <div className="field-row">
          <input
            id="downloadLocalPath"
            type="text"
            value={settings.downloadLocalPath || ""}
            placeholder="ex: C:\Downloads\NoSubVOD"
            onChange={(e) => {
              setSettings((prev) => ({
                ...prev,
                downloadLocalPath: e.target.value,
              }));
              setSuccess("");
            }}
            className="settings-select field-grow"
          />
          <button
            type="button"
            onClick={() => selectFolder("downloadLocalPath")}
            className="action-btn"
          >
            Parcourir
          </button>
        </div>
      </div>

      <div className="settings-group mt-2">
        <label htmlFor="downloadNetworkSharedPath" className="settings-label">
          Chemin Réseau (SMB/NFS)
        </label>
        <div className="field-row">
          <input
            id="downloadNetworkSharedPath"
            type="text"
            value={settings.downloadNetworkSharedPath || ""}
            placeholder="ex: \\NAS\Downloads\NoSubVOD"
            onChange={(e) => {
              setSettings((prev) => ({
                ...prev,
                downloadNetworkSharedPath: e.target.value,
              }));
              setSuccess("");
            }}
            className="settings-select field-grow"
          />
          <button
            type="button"
            onClick={() => selectFolder("downloadNetworkSharedPath")}
            className="action-btn"
          >
            Parcourir
          </button>
        </div>
      </div>
    </div>
  ),
);
DownloadsSection.displayName = "DownloadsSection";

const TwitchAccountSection = React.memo(
  ({
    twitchStatus,
    twitchLinking,
    twitchPolling,
    twitchImporting,
    twitchError,
    twitchManualAuthUrl,
    openTwitchManual,
    linkTwitch,
    unlinkTwitch,
    importFollows,
    setImportFollowsSetting,
  }: any) => {
    let linkButtonLabel = "Lier mon compte Twitch";
    if (twitchLinking) {
      linkButtonLabel = "Préparation...";
    } else if (twitchPolling) {
      linkButtonLabel = "En attente...";
    }

    return (
      <div className="card settings-card">
        <h2>Compte Twitch</h2>
        <p className="settings-description">
          Lie ton compte Twitch pour les messages et l&apos;import de Subs.
        </p>

        {!twitchStatus?.clientConfigured && (
          <div className="twitch-warning">
            Configuration Twitch incomplète (.env).
          </div>
        )}

        {twitchError && <div className="error-text">{twitchError}</div>}

        {twitchStatus?.linked ? (
          <div>
            <div className="twitch-user-row">
              {twitchStatus.userAvatar && (
                <img
                  src={twitchStatus.userAvatar}
                  alt="Avatar"
                  className="twitch-avatar"
                />
              )}
              <div>
                <div className="twitch-display-name">
                  {twitchStatus.userDisplayName || twitchStatus.userLogin}
                </div>
                {twitchStatus.userLogin && (
                  <div className="twitch-login">@{twitchStatus.userLogin}</div>
                )}
              </div>
              <button
                onClick={unlinkTwitch}
                className="action-btn secondary-btn soft-outline-btn ml-auto"
              >
                Déconnecter
              </button>
            </div>

            <div className="settings-subsection">
              <div className="toggle-row mb-2">
                <span>
                  <strong>
                    <label htmlFor="importFollowsToggle" className="mb-0">
                      Importer les chaînes suivies
                    </label>
                  </strong>
                  <small>
                    Ajoute auto. tes follows Twitch dans tes Subs NoSubVOD
                  </small>
                </span>
                <input
                  id="importFollowsToggle"
                  type="checkbox"
                  checked={twitchStatus.importFollows ?? false}
                  onChange={(e) => setImportFollowsSetting(e.target.checked)}
                />
              </div>
              <button
                onClick={importFollows}
                disabled={twitchImporting}
                className="action-btn secondary-btn soft-outline-btn"
              >
                {twitchImporting ? "Importation..." : "Importer maintenant"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              onClick={linkTwitch}
              disabled={
                twitchLinking ||
                twitchPolling ||
                (twitchStatus !== null && !twitchStatus.clientConfigured)
              }
              className="action-btn twitch-connect-btn"
            >
              {linkButtonLabel}
            </button>

            {twitchManualAuthUrl && (
              <button
                type="button"
                onClick={() => {
                  openTwitchManual(twitchManualAuthUrl);
                }}
                className="action-btn secondary-btn soft-outline-btn"
                style={{ marginTop: "10px", display: "inline-flex" }}
              >
                Ouvrir Twitch manuellement
              </button>
            )}
          </>
        )}
      </div>
    );
  },
);
TwitchAccountSection.displayName = "TwitchAccountSection";

const TrustedDevicesSection = React.memo(
  ({ devices, pendingDeviceId, onToggleTrusted }: any) => (
    <div className="card settings-card">
      <h2>Trusted Devices</h2>
      <p className="settings-description">
        Gérez l&apos;accès sans token pour vos appareils.
      </p>

      {devices.length === 0 ? (
        <div className="trusted-devices-empty">Aucun appareil détecté.</div>
      ) : (
        <div className="trusted-devices-list">
          {devices.map((device: TrustedDevice) => (
            <div key={device.deviceId} className="trusted-device-item">
              <div className="trusted-device-header">
                <div className="trusted-device-id">{device.deviceId}</div>
                <label className="trusted-device-toggle">
                  <span className="trusted-device-toggle-label">Trusted</span>
                  <input
                    type="checkbox"
                    checked={device.trusted}
                    disabled={pendingDeviceId === device.deviceId}
                    onChange={(e) =>
                      onToggleTrusted(device.deviceId, e.target.checked)
                    }
                  />
                </label>
              </div>
              <div className="trusted-device-meta">
                Dernier accès: {new Date(device.lastSeenAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  ),
);
TrustedDevicesSection.displayName = "TrustedDevicesSection";

const ProfileBackupSection = React.memo(
  ({
    exporting,
    importing,
    onExport,
    onImport,
    importInputRef,
    onImportFileSelected,
  }: {
    exporting: boolean;
    importing: boolean;
    onExport: () => Promise<void>;
    onImport: () => void;
    importInputRef: React.RefObject<HTMLInputElement | null>;
    onImportFileSelected: (
      event: React.ChangeEvent<HTMLInputElement>,
    ) => Promise<void>;
  }) => (
    <div className="card settings-card">
      <h2>Profil utilisateur</h2>
      <p className="settings-description">
        Exporte ton profil (historique, subs, watchlist, settings) dans un
        fichier JSON que tu peux conserver où tu veux, puis réimporter après
        réinstallation.
      </p>

      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(event) => {
          void onImportFileSelected(event);
        }}
      />

      <div className="btn-row">
        <button
          className="action-btn"
          onClick={() => {
            void onExport();
          }}
          disabled={exporting || importing}
        >
          {exporting ? "Export..." : "Exporter le profil"}
        </button>

        <button
          className="action-btn secondary-btn soft-outline-btn"
          onClick={onImport}
          disabled={exporting || importing}
        >
          {importing ? "Import..." : "Importer un profil"}
        </button>
      </div>

      <small className="help-text">
        Note: les tokens sensibles ne sont pas inclus dans le fichier exporté.
      </small>
    </div>
  ),
);
ProfileBackupSection.displayName = "ProfileBackupSection";

const DiagnosticsLogsSection = React.memo(
  ({
    exporting,
    onExport,
  }: {
    exporting: boolean;
    onExport: () => Promise<void>;
  }) => (
    <div className="card settings-card">
      <h2>Logs diagnostic</h2>
      <p className="settings-description">
        Exporte les logs backend Rust et les logs frontend pour analyser les
        crashs et erreurs runtime.
      </p>

      <div className="btn-row">
        <button
          className="action-btn"
          onClick={() => {
            void onExport();
          }}
          disabled={exporting}
        >
          {exporting ? "Export..." : "Exporter logs diagnostic"}
        </button>
      </div>

      <small className="help-text">
        Conseil: après un crash, relance l&apos;app puis exporte immédiatement
        les logs.
      </small>
    </div>
  ),
);
DiagnosticsLogsSection.displayName = "DiagnosticsLogsSection";

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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <h2>Serveur local (NoSubVod Desktop)</h2>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            className="action-btn"
            style={{ padding: "4px 8px", fontSize: "0.85rem" }}
            onClick={scanNetwork}
            disabled={scanning}
          >
            {scanning ? "Scan en cours..." : "Re-scanner"}
          </button>

          {serverUrl && token && (
            <div
              style={{
                padding: "4px 12px",
                borderRadius: "16px",
                fontSize: "0.85rem",
                fontWeight: 600,
                background: isOnline
                  ? "rgba(46, 204, 113, 0.15)"
                  : "rgba(231, 76, 60, 0.15)",
                color: isOnline ? "#2ecc71" : "#e74c3c",
              }}
            >
              {isOnline ? "Connecté" : "Déconnecté"}
            </div>
          )}
        </div>
      </div>

      <p className="settings-description" style={{ marginBottom: "16px" }}>
        {serverUrl && token
          ? `Actuellement lié à : ${serverUrl}`
          : "Connectez l'application Mobile à votre instance Desktop en la sélectionnant ci-dessous."}
      </p>

      {serverUrl && token && (
        <>
          <div
            style={{
              marginBottom: "16px",
              padding: "12px",
              borderRadius: "10px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <label className="settings-label" htmlFor="pairing-apns-token">
              Token APNs iPhone (optionnel)
            </label>
            <input
              id="pairing-apns-token"
              type="password"
              className="search-input"
              placeholder="Coller le token APNs si disponible"
              value={pairingApnsToken}
              onChange={(event) => {
                setPairingApnsToken(event.target.value);
                setConnectionError("");
              }}
              style={{ width: "100%", boxSizing: "border-box" }}
            />

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginTop: "10px",
                color: "#d1d5db",
                fontSize: "0.9rem",
              }}
            >
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
              className="action-btn"
              style={{ marginTop: "10px", width: "100%" }}
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
            className="action-btn"
            style={{
              background: "#e74c3c",
              color: "white",
              marginBottom: "16px",
              width: "100%",
            }}
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
        <div className="error-text" style={{ marginBottom: "16px" }}>
          {connectionError}
        </div>
      )}

      {desktopServers.length === 0 && !scanning && (!serverUrl || !token) && (
        <div
          style={{
            padding: "16px",
            background: "rgba(255,255,255,0.05)",
            borderRadius: "8px",
            textAlign: "center",
          }}
        >
          <p style={{ color: "#a3a3a3", margin: 0 }}>
            Aucun Serveur NoSubVod Desktop n&apos;a été détecté
          </p>
        </div>
      )}

      {desktopServers.length > 0 && (!serverUrl || !token) && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
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

export default function Settings() {
  const isPageVisible = usePageVisibility();
  const [settings, setSettings] = useState<ExperienceSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [proxies, setProxies] = useState<ProxyInfo[]>([]);
  const [activeProxy, setActiveProxy] = useState<ProxyInfo | null>(null);
  const [twitchStatus, setTwitchStatus] = useState<TwitchStatus | null>(null);
  const [twitchLinking, setTwitchLinking] = useState(false);
  const [twitchPolling, setTwitchPolling] = useState(false);
  const [twitchImporting, setTwitchImporting] = useState(false);
  const [twitchError, setTwitchError] = useState("");
  const [twitchManualAuthUrl, setTwitchManualAuthUrl] = useState<string | null>(
    null,
  );
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [trustedDevicePendingId, setTrustedDevicePendingId] = useState<
    string | null
  >(null);
  const [profileExporting, setProfileExporting] = useState(false);
  const [profileImporting, setProfileImporting] = useState(false);
  const [diagnosticsExporting, setDiagnosticsExporting] = useState(false);
  const profileImportInputRef = useRef<HTMLInputElement | null>(null);
  const twitchPollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const stopTwitchPolling = useCallback(() => {
    if (twitchPollingTimerRef.current) {
      clearInterval(twitchPollingTimerRef.current);
      twitchPollingTimerRef.current = null;
    }
    setTwitchPolling(false);
  }, []);

  const startTwitchStatusPolling = useCallback(() => {
    stopTwitchPolling();
    setTwitchPolling(true);

    let attempts = 0;
    const pollStatus = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      attempts++;
      try {
        const r = await fetch("/api/auth/twitch/status");
        if (!r.ok || attempts >= 60) {
          stopTwitchPolling();
          return;
        }

        const data = await r.json();
        setTwitchStatus(data);
        if (data.linked) {
          stopTwitchPolling();
        }
      } catch {
        if (attempts >= 60) {
          stopTwitchPolling();
        }
      }
    };

    void pollStatus();
    twitchPollingTimerRef.current = setInterval(() => {
      void pollStatus();
    }, 2000);
  }, [stopTwitchPolling]);

  const fetchSettingsData = useCallback(async () => {
    try {
      const [sets, ads, pxs, tw, devs] = await Promise.all([
        fetch("/api/settings").then((r) => (r.ok ? r.json() : defaultSettings)),
        fetch("/api/adblock/status").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/adblock/proxies").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/auth/twitch/status").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/trusted-devices").then((r) => (r.ok ? r.json() : [])),
      ]);
      setSettings({ ...defaultSettings, ...normalizeExperienceSettings(sets) });
      setActiveProxy(ads);
      setProxies(pxs);
      setTwitchStatus(tw);
      setTrustedDevices(devs);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const exportProfile = useCallback(async () => {
    setProfileExporting(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/profile/export");
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Impossible d'exporter le profil.");
      }

      const blob = await response.blob();
      const fileName =
        parseFilenameFromDisposition(
          response.headers.get("content-disposition"),
        ) || buildFallbackProfileFilename();

      const maybeNavigator = globalThis.navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };

      const file = new File([blob], fileName, { type: "application/json" });
      const canShareFile =
        typeof maybeNavigator.share === "function" &&
        typeof maybeNavigator.canShare === "function" &&
        maybeNavigator.canShare({ files: [file] });

      if (canShareFile) {
        await maybeNavigator.share({
          title: "NoSubVOD Profile",
          files: [file],
        });
      } else {
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName;
        anchor.rel = "noopener";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      }

      setSuccess("Profil exporté avec succès.");
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return;
      }
      setError(err?.message || "Impossible d'exporter le profil.");
    } finally {
      setProfileExporting(false);
    }
  }, []);

  const triggerProfileImport = useCallback(() => {
    profileImportInputRef.current?.click();
  }, []);

  const exportDiagnosticLogs = useCallback(async () => {
    setDiagnosticsExporting(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/diagnostics/logs/export");
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          payload?.error || "Impossible d'exporter les logs diagnostic.",
        );
      }

      const blob = await response.blob();
      const backendFileName =
        parseFilenameFromDisposition(
          response.headers.get("content-disposition"),
        ) || buildFallbackDiagnosticsFilename();

      const loggerRuntime = globalThis as typeof globalThis &
        FrontendLoggerRuntime;
      const frontendPayload = loggerRuntime.__NSV_LOGGER__?.exportLogs?.(
        "settings-diagnostics",
      ) || {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        reason: "settings-diagnostics-fallback",
        loggerAvailable: false,
        entries: [],
      };

      const frontendBlob = new Blob(
        [JSON.stringify(frontendPayload, null, 2)],
        {
          type: "application/json",
        },
      );
      const frontendFileName = buildFallbackFrontendDiagnosticsFilename();

      const maybeNavigator = globalThis.navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };

      const backendFile = new File([blob], backendFileName, {
        type: "text/plain",
      });
      const frontendFile = new File([frontendBlob], frontendFileName, {
        type: "application/json",
      });
      const files = [backendFile, frontendFile];

      const canShareFile =
        typeof maybeNavigator.share === "function" &&
        (typeof maybeNavigator.canShare !== "function" ||
          maybeNavigator.canShare({ files }));

      if (canShareFile) {
        await maybeNavigator.share({
          title: "NoSubVOD Diagnostics",
          files,
        });
      } else {
        triggerBlobDownload(blob, backendFileName);
        triggerBlobDownload(frontendBlob, frontendFileName);
      }

      setSuccess("Logs backend et frontend exportés avec succès.");
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return;
      }
      setError(err?.message || "Impossible d'exporter les logs diagnostic.");
    } finally {
      setDiagnosticsExporting(false);
    }
  }, []);

  const onProfileFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const selected = event.target.files?.[0];
      if (!selected) {
        return;
      }

      setProfileImporting(true);
      setError("");
      setSuccess("");

      try {
        const text = await selected.text();
        JSON.parse(text);

        const response = await fetch("/api/profile/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: text,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "Impossible d'importer le profil.");
        }

        await fetchSettingsData();
        setSuccess("Profil importé avec succès.");
      } catch (err: any) {
        setError(err?.message || "Impossible d'importer le profil.");
      } finally {
        setProfileImporting(false);
        event.target.value = "";
      }
    },
    [fetchSettingsData],
  );

  useEffect(() => {
    void fetchSettingsData();
  }, [fetchSettingsData]);

  const refreshAdblockData = useCallback(async () => {
    try {
      const [ads, pxs] = await Promise.all([
        fetch("/api/adblock/status").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/adblock/proxies").then((r) => (r.ok ? r.json() : [])),
      ]);
      setActiveProxy(ads);
      setProxies(pxs);
    } catch {
      // Keep previous values; a later tick will retry.
    }
  }, []);

  useInterval(
    () => {
      void refreshAdblockData();
    },
    isPageVisible ? 30000 : null,
  );

  const saveSettings = useCallback(async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      setSuccess("Settings saved.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const selectFolder = useCallback(async (field: keyof ExperienceSettings) => {
    try {
      const res = await fetch("/api/system/dialog/folder");
      if (!res.ok) return;
      const { path } = await res.json();
      if (path) setSettings((prev) => ({ ...prev, [field]: path }));
    } catch (e) {
      console.error("Failed to open dialog", e);
    }
  }, []);

  const linkTwitch = useCallback(async () => {
    setError("");
    setSuccess("");
    setTwitchError("");
    setTwitchManualAuthUrl(null);
    setTwitchLinking(true);

    if (twitchStatus && !twitchStatus.clientConfigured) {
      const msg =
        "Configuration OAuth Twitch manquante côté serveur. Vérifie le fichier .env.";
      setError(msg);
      setTwitchError(msg);
      setTwitchLinking(false);
      return;
    }

    const popup = globalThis.open("", "_blank", "noopener,noreferrer");

    try {
      const authUrl = await fetchTwitchAuthUrl(resolveTwitchAuthPlatformHint());
      setTwitchManualAuthUrl(authUrl);
      const launchResult = await openTwitchAuthFlow(authUrl, popup);
      setSuccess("Ouverture de Twitch...");
      setTwitchError("");
      if (launchResult === "opened") {
        startTwitchStatusPolling();
      }
    } catch (openError) {
      if (popup && !popup.closed) {
        popup.close();
      }
      console.error("Failed to start Twitch OAuth", openError);
      const details = unknownErrorMessage(openError);
      const msg = details
        ? `Impossible d'ouvrir Twitch (${details}).`
        : "Impossible d'ouvrir la fenêtre Twitch. Vérifie ta connexion ou redémarre l'app.";
      setError(msg);
      setTwitchError(msg);
    } finally {
      setTwitchLinking(false);
    }
  }, [startTwitchStatusPolling, twitchStatus]);

  const openTwitchManual = useCallback(
    async (manualAuthUrl: string) => {
      setError("");
      setTwitchError("");

      try {
        const authUrl = normalizeTwitchAuthUrl(manualAuthUrl);
        const popup = globalThis.open("", "_blank", "noopener,noreferrer");
        const launchResult = await openTwitchAuthFlow(authUrl, popup);
        setSuccess("Ouverture de Twitch...");
        if (launchResult === "opened") {
          startTwitchStatusPolling();
        }
      } catch (openError) {
        const details = unknownErrorMessage(openError);
        const msg = details
          ? `Impossible d'ouvrir Twitch (${details}).`
          : "Impossible d'ouvrir Twitch manuellement.";
        setError(msg);
        setTwitchError(msg);
      }
    },
    [startTwitchStatusPolling],
  );

  useEffect(() => {
    const refreshAuthStatus = () => {
      void (async () => {
        try {
          const res = await fetch("/api/auth/twitch/status");
          if (!res.ok) return;
          const data = await res.json();
          setTwitchStatus(data);
          if (data.linked) {
            stopTwitchPolling();
            setTwitchError("");
            setTwitchManualAuthUrl(null);
            setSuccess("Compte Twitch lie.");
          }
        } catch {
          // Keep polling fallback if this refresh fails.
        }
      })();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== globalThis.location.origin) {
        return;
      }
      const payload = event.data as { type?: string } | null;
      if (payload?.type !== "nsv:twitch-auth") {
        return;
      }
      refreshAuthStatus();
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== "nsv_twitch_oauth_status") {
        return;
      }
      refreshAuthStatus();
    };

    globalThis.addEventListener("message", onMessage);
    globalThis.addEventListener("storage", onStorage);

    return () => {
      globalThis.removeEventListener("message", onMessage);
      globalThis.removeEventListener("storage", onStorage);
    };
  }, [stopTwitchPolling]);

  const unlinkTwitch = useCallback(async () => {
    try {
      await fetch("/api/auth/twitch", { method: "DELETE" });
      const res = await fetch("/api/auth/twitch/status");
      if (res.ok) setTwitchStatus(await res.json());
    } catch (e) {
      console.error("Failed to unlink Twitch", e);
    }
  }, []);

  const importFollows = useCallback(async () => {
    setTwitchImporting(true);
    try {
      await fetch("/api/auth/twitch/import-follows", { method: "POST" });
    } catch (e) {
      console.error("Failed to import follows", e);
    } finally {
      setTwitchImporting(false);
    }
  }, []);

  const setImportFollowsSetting = useCallback(async (value: boolean) => {
    try {
      await fetch("/api/auth/twitch/import-follows-setting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: value }),
      });
      const res = await fetch("/api/auth/twitch/status");
      if (res.ok) setTwitchStatus(await res.json());
    } catch (e) {
      console.error("Failed to update import follows setting", e);
    }
  }, []);

  const onToggleTrusted = useCallback(
    async (deviceId: string, trusted: boolean) => {
      setTrustedDevicePendingId(deviceId);
      try {
        const res = await fetch(
          `/api/trusted-devices/${encodeURIComponent(deviceId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trusted }),
          },
        );
        if (!res.ok) throw new Error("Failed to update trusted device");
        const devsRes = await fetch("/api/trusted-devices");
        if (devsRes.ok) setTrustedDevices(await devsRes.json());
        setSuccess("Trusted devices mis à jour.");
      } catch (e: any) {
        setError(e?.message || "Failed to update trusted device");
      } finally {
        setTrustedDevicePendingId(null);
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (twitchPollingTimerRef.current) {
        clearInterval(twitchPollingTimerRef.current);
        twitchPollingTimerRef.current = null;
      }
    };
  }, []);

  return (
    <>
      <TopBar mode="back" title="Settings" />
      <div className="container container-settings">
        <VideoPlayerSection
          settings={settings}
          setSettings={setSettings}
          setSuccess={setSuccess}
        />
        <AdblockSection
          settings={settings}
          setSettings={setSettings}
          setSuccess={setSuccess}
          proxies={proxies}
          activeProxy={activeProxy}
        />
        <DownloadsSection
          settings={settings}
          setSettings={setSettings}
          setSuccess={setSuccess}
          selectFolder={selectFolder}
        />
        <TwitchAccountSection
          twitchStatus={twitchStatus}
          twitchLinking={twitchLinking}
          twitchPolling={twitchPolling}
          twitchImporting={twitchImporting}
          twitchError={twitchError}
          twitchManualAuthUrl={twitchManualAuthUrl}
          openTwitchManual={openTwitchManual}
          linkTwitch={linkTwitch}
          unlinkTwitch={unlinkTwitch}
          importFollows={importFollows}
          setImportFollowsSetting={setImportFollowsSetting}
        />
        <TrustedDevicesSection
          devices={trustedDevices}
          pendingDeviceId={trustedDevicePendingId}
          onToggleTrusted={onToggleTrusted}
        />
        <ProfileBackupSection
          exporting={profileExporting}
          importing={profileImporting}
          onExport={exportProfile}
          onImport={triggerProfileImport}
          importInputRef={profileImportInputRef}
          onImportFileSelected={onProfileFileSelected}
        />
        <DiagnosticsLogsSection
          exporting={diagnosticsExporting}
          onExport={exportDiagnosticLogs}
        />
        <ServerConnectionSection />
        <div className="card settings-card settings-footer-card">
          {error && <div className="error-text">{error}</div>}
          {success && <div className="success-text">{success}</div>}
          <div className="btn-row">
            <button
              className="action-btn"
              onClick={saveSettings}
              disabled={loading || saving}
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
