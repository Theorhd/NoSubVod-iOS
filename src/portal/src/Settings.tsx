import React, { useEffect, useState, useCallback } from "react";
import {
  ExperienceSettings,
  ProxyInfo,
  TrustedDevice,
  TwitchStatus,
} from "../../shared/types";
import { TopBar } from "./components/TopBar";
import { useExtensions } from "./ExtensionContext";
import { normalizeExperienceSettings } from "./utils/experienceSettings";
import { useServer } from "./ServerContext";

const defaultSettings: ExperienceSettings = {
  oneSync: false,
  adblockEnabled: false,
  adblockProxy: "",
  adblockProxyMode: "auto",
  defaultVideoQuality: "auto",
  launchAtLogin: false,
  enabledExtensions: [],
};

interface SectionProps {
  readonly settings: ExperienceSettings;
  readonly setSettings: React.Dispatch<
    React.SetStateAction<ExperienceSettings>
  >;
  readonly setSuccess: (val: string) => void;
}

const ServerExperienceSection = React.memo(
  ({
    settings,
    loading,
    setSettings,
    setSuccess,
  }: SectionProps & { loading: boolean }) => (
    <div className="card settings-card">
      <h2>Server Experience</h2>
      <p className="settings-description">
        Gérez le comportement global de votre serveur NoSubVOD.
      </p>
      {loading ? (
        <div className="trusted-devices-empty">Loading settings...</div>
      ) : (
        <>
          <div className="toggle-row">
            <span>
              <strong>
                <label htmlFor="oneSyncToggle" className="mb-0">
                  OneSync
                </label>
              </strong>
              <small>
                Synchronise les données entre devices (subs, historique)
              </small>
            </span>
            <input
              id="oneSyncToggle"
              type="checkbox"
              checked={settings.oneSync}
              onChange={(e) => {
                setSettings((prev) => ({ ...prev, oneSync: e.target.checked }));
                setSuccess("");
              }}
            />
          </div>

          <div className="toggle-row mt-2">
            <span>
              <strong>
                <label htmlFor="launchAtLoginToggle" className="mb-0">
                  Lancer avec l&apos;OS
                </label>
              </strong>
              <small>
                Démarre NoSubVOD automatiquement à l&apos;ouverture de session
              </small>
            </span>
            <input
              id="launchAtLoginToggle"
              type="checkbox"
              checked={settings.launchAtLogin}
              onChange={(e) => {
                setSettings((prev) => ({
                  ...prev,
                  launchAtLogin: e.target.checked,
                }));
                setSuccess("");
              }}
            />
          </div>
        </>
      )}
    </div>
  ),
);
ServerExperienceSection.displayName = "ServerExperienceSection";

const ExtensionsSection = React.memo(() => {
  const { extensions, enabledExtensions, toggleExtension, isLoading } =
    useExtensions();

  if (isLoading) {
    return (
      <div className="card settings-card">
        <h2>Extensions</h2>
        <div className="trusted-devices-empty">
          Chargement des extensions...
        </div>
      </div>
    );
  }

  return (
    <div className="card settings-card">
      <h2>Extensions</h2>
      <p className="settings-description">
        Activez ou désactivez vos extensions installées.
      </p>
      {extensions.length === 0 ? (
        <div className="trusted-devices-empty">
          Aucune extension installée. Ajoutez un dossier d&apos;extension valide
          pour la gérer ici.
        </div>
      ) : (
        <>
          <div className="trusted-devices-list">
            {extensions.map((ext) => {
              const isEnabled = enabledExtensions.includes(ext.manifest.id);
              return (
                <div key={ext.manifest.id} className="trusted-device-item">
                  <div className="trusted-device-header">
                    <div className="trusted-device-id">
                      <strong>{ext.manifest.name}</strong>
                      <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                        v{ext.manifest.version} par{" "}
                        {ext.manifest.author || "Inconnu"}
                      </div>
                    </div>
                    <label className="trusted-device-toggle">
                      <span className="trusted-device-toggle-label">
                        {isEnabled ? "Active" : "Inactive"}
                      </span>
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(e) =>
                          toggleExtension(ext.manifest.id, e.target.checked)
                        }
                      />
                    </label>
                  </div>
                  {ext.manifest.description && (
                    <div className="trusted-device-meta">
                      {ext.manifest.description}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="help-text mt-2" style={{ fontStyle: "italic" }}>
            Note: Désactiver une extension peut nécessiter un rechargement de
            l&apos;application.
          </p>
        </>
      )}
    </div>
  );
});
ExtensionsSection.displayName = "ExtensionsSection";

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
          <option value="480">480p</option>
          <option value="720">720p</option>
          <option value="1080">1080p</option>
        </select>
        <small className="help-text">
          La vidéo tentera de démarrer avec cette résolution si elle est
          disponible.
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
    twitchPolling,
    twitchImporting,
    linkTwitch,
    unlinkTwitch,
    importFollows,
    setImportFollowsSetting,
  }: any) => (
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
        <button
          onClick={linkTwitch}
          disabled={
            twitchPolling ||
            (twitchStatus !== null && !twitchStatus.clientConfigured)
          }
          className="action-btn twitch-connect-btn"
        >
          {twitchPolling ? "En attente..." : "Lier mon compte Twitch"}
        </button>
      )}
    </div>
  ),
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

const ServerConnectionSection = React.memo(() => {
  const { serverUrl, setServerUrl, token, setToken, removeToken, isOnline } =
    useServer();
  const [inputToken, setInputToken] = useState(token || "");
  const [inputUrl, setInputUrl] = useState(serverUrl || "");

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
          {isOnline ? "En Ligne" : "Hors Ligne"}
        </div>
      </div>

      <p className="settings-description" style={{ marginBottom: "8px" }}>
        Connectez l&apos;application Mobile à votre instance Desktop.
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          marginTop: "16px",
        }}
      >
        <input
          type="text"
          className="search-input"
          placeholder="https://192.168.1.162:23456"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
        />
        <div style={{ display: "flex", gap: "10px" }}>
          <input
            type="password"
            className="search-input"
            placeholder="Server Token"
            value={inputToken}
            onChange={(e) => setInputToken(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="action-btn"
            onClick={() => {
              if (inputUrl.trim()) setServerUrl(inputUrl.trim());
              if (inputToken.trim()) {
                setToken(inputToken.trim());
              } else {
                removeToken();
              }
            }}
          >
            Sauvegarder
          </button>
        </div>
      </div>
    </div>
  );
});
ServerConnectionSection.displayName = "ServerConnectionSection";

export default function Settings() {
  const [settings, setSettings] = useState<ExperienceSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [proxies, setProxies] = useState<ProxyInfo[]>([]);
  const [activeProxy, setActiveProxy] = useState<ProxyInfo | null>(null);
  const [twitchStatus, setTwitchStatus] = useState<TwitchStatus | null>(null);
  const [twitchPolling, setTwitchPolling] = useState(false);
  const [twitchImporting, setTwitchImporting] = useState(false);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [trustedDevicePendingId, setTrustedDevicePendingId] = useState<
    string | null
  >(null);

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

  useEffect(() => {
    void fetchSettingsData();
    const interval = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
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
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchSettingsData]);

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
    try {
      const res = await fetch("/api/auth/twitch/start");
      if (!res.ok) return;
      const { authUrl } = await res.json();
      window.open(authUrl, "_blank", "noopener,noreferrer");
      setTwitchPolling(true);
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        const r = await fetch("/api/auth/twitch/status");
        if (!r.ok || attempts >= 60) {
          clearInterval(poll);
          setTwitchPolling(false);
          return;
        }
        const data = await r.json();
        setTwitchStatus(data);
        if (data.linked) {
          clearInterval(poll);
          setTwitchPolling(false);
        }
      }, 2000);
    } catch (e) {
      console.error("Failed to start Twitch auth", e);
    }
  }, []);

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

  return (
    <>
      <TopBar mode="back" title="Settings" />
      <div className="container container-settings">
        <ServerExperienceSection
          settings={settings}
          loading={loading}
          setSettings={setSettings}
          setSuccess={setSuccess}
        />
        <ExtensionsSection />
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
          twitchPolling={twitchPolling}
          twitchImporting={twitchImporting}
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
