import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  ExperienceSettings,
  ProxyInfo,
  TrustedDevice,
  TwitchStatus,
} from "../../shared/types";
import { TopBar } from "./components/TopBar";
import { normalizeExperienceSettings } from "./utils/experienceSettings";
import { useInterval } from "../../shared/hooks/useInterval";
import { usePageVisibility } from "../../shared/hooks/usePageVisibility";
import { isMobileDevice, isTauriRuntime } from "./utils/capabilities";
import "./styles/Settings.scss";
import { ServerConnectionSection } from "./components/settings/ServerConnectionSection";
import {
  VideoPlayerSection,
  AdblockSection,
  DownloadsSection,
  TwitchAccountSection,
  TrustedDevicesSection,
  ProfileBackupSection,
  DiagnosticsLogsSection,
  LanguageSection,
} from "./components/settings/UISections";

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

// Extracted UI Sections

// Extracted ServerConnectionSection

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
        <LanguageSection />
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
