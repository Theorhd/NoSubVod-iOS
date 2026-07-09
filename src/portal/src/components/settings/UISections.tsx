import React from "react";
import {
  ExperienceSettings,
  ProxyInfo,
  TrustedDevice,
} from "../../../../shared/types";
import styles from "./UISections.module.scss";
import { useTranslation } from "react-i18next";

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
            setSettings((prev: any) => ({
              ...prev,
              defaultVideoQuality: e.target.value,
            }));
            setSuccess("");
          }}
        >
          <option value="auto">Automatique</option>
          <option value="source">Source (chunked)</option>
          <option value="1080">1080p</option>
          <option value="720">720p</option>
          <option value="480">480p</option>
          <option value="audio">Audio Only</option>
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
              setSettings((prev: any) => ({
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
                  setSettings((prev: any) => ({
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
                    setSettings((prev: any) => ({
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
              setSettings((prev: any) => ({
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
              setSettings((prev: any) => ({
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
                className={`action-btn secondary-btn soft-outline-btn ${styles["extracted-style-1"]}`}
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
        onChange={(event) => {
          void onImportFileSelected(event);
        }}
        className={styles["extracted-style-2"]}
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

const LanguageSection = React.memo(() => {
  const { t, i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    localStorage.setItem("nsv_language", lng);
  };

  return (
    <div className="card settings-card">
      <h2>{t("settings.language")}</h2>
      <p className="settings-description">
        Sélectionnez la langue de l&apos;application.
      </p>

      <div className="settings-group">
        <label htmlFor="languageSelect" className="settings-label">
          {t("settings.language")}
        </label>
        <select
          id="languageSelect"
          className="settings-select"
          value={i18n.language}
          onChange={(e) => changeLanguage(e.target.value)}
        >
          <option value="fr">{t("settings.language_fr")}</option>
          <option value="en">{t("settings.language_en")}</option>
        </select>
      </div>
    </div>
  );
});
LanguageSection.displayName = "LanguageSection";

export {
  LanguageSection,
  VideoPlayerSection,
  AdblockSection,
  DownloadsSection,
  TwitchAccountSection,
  TrustedDevicesSection,
  ProfileBackupSection,
  DiagnosticsLogsSection,
};
