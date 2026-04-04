import { useCallback, useEffect, useState } from "react";
import { DownloadedFile, ActiveDownload } from "../../../shared/types";
import { useInterval } from "../../../shared/hooks/useInterval";

const DEBUG_DOWNLOADS = false;
const MAX_POLLING_DELAY_MS = 60000;
const OFFLINE_POLLING_DELAY_MS = 30000;
const HIDDEN_POLLING_DELAY_MS = 15000;
const ACTIVE_DOWNLOAD_POLLING_DELAY_MS = 3000;
const DEFAULT_VISIBLE_POLLING_DELAY_MS = 6000;
const MAX_BACKOFF_EXPONENT = 4;

export function useDownloadsData() {
  const [files, setFiles] = useState<DownloadedFile[]>([]);
  const [activeDownloads, setActiveDownloads] = useState<ActiveDownload[]>([]);
  const [loading, setLoading] = useState(true);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined"
      ? true
      : document.visibilityState === "visible",
  );
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  const fetchDownloads = useCallback(async () => {
    let requestSucceeded = false;

    try {
      const [filesRes, activeRes] = await Promise.all([
        fetch("/api/downloads"),
        fetch("/api/downloads/active"),
      ]);

      if (DEBUG_DOWNLOADS) {
        console.log(
          "[Downloads] fetch /api/downloads status:",
          filesRes.status,
        );
        console.log(
          "[Downloads] fetch /api/downloads/active status:",
          activeRes.status,
        );
      }

      if (filesRes.ok) {
        const data = (await filesRes.json()) as DownloadedFile[];
        setFiles(data);
        requestSucceeded = true;
      }

      if (activeRes.ok) {
        setActiveDownloads((await activeRes.json()) as ActiveDownload[]);
        requestSucceeded = true;
      }
    } catch (error) {
      if (DEBUG_DOWNLOADS) {
        console.error("[Downloads] Failed to fetch downloads", error);
      }
    } finally {
      setLoading(false);
      setConsecutiveFailures((prev) => {
        if (requestSucceeded) {
          return 0;
        }
        return Math.min(prev + 1, MAX_BACKOFF_EXPONENT);
      });
    }
  }, []);

  useEffect(() => {
    void fetchDownloads();
  }, [fetchDownloads]);

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsPageVisible(document.visibilityState === "visible");
    };

    const onOnline = () => {
      setIsOnline(true);
    };

    const onOffline = () => {
      setIsOnline(false);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    globalThis.addEventListener("online", onOnline);
    globalThis.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      globalThis.removeEventListener("online", onOnline);
      globalThis.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (isOnline && isPageVisible) {
      void fetchDownloads();
    }
  }, [fetchDownloads, isOnline, isPageVisible]);

  let baseDelay = DEFAULT_VISIBLE_POLLING_DELAY_MS;
  if (!isOnline) {
    baseDelay = OFFLINE_POLLING_DELAY_MS;
  } else if (isPageVisible === false) {
    baseDelay = HIDDEN_POLLING_DELAY_MS;
  } else if (activeDownloads.length > 0) {
    baseDelay = ACTIVE_DOWNLOAD_POLLING_DELAY_MS;
  }

  const backoffMultiplier =
    consecutiveFailures > 0 ? 2 ** consecutiveFailures : 1;
  const downloadsPollingDelay = Math.min(
    baseDelay * backoffMultiplier,
    MAX_POLLING_DELAY_MS,
  );

  useInterval(fetchDownloads, downloadsPollingDelay);

  const resolveDownloadUrl = useCallback((url: string) => {
    if (!url) return "";

    let resolved: string;
    if (url.startsWith("/api/")) resolved = url;
    else if (url.startsWith("/shared-downloads/")) resolved = `/api${url}`;
    else if (url.startsWith("/")) resolved = `/api${url}`;
    else resolved = `/api/${url}`;

    const standaloneToken =
      sessionStorage.getItem("nsv_token") || localStorage.getItem("nsv_token");
    const pairedToken = localStorage.getItem("nsv_server_token");
    const serverUrl = localStorage.getItem("nsv_server_url") || "";

    const isRemoteDownloadPath =
      resolved === "/api/downloads" ||
      resolved.startsWith("/api/downloads/") ||
      resolved.startsWith("/api/shared-downloads/");

    const useRemoteDownloads =
      Boolean(serverUrl && pairedToken) && isRemoteDownloadPath;

    if (useRemoteDownloads) {
      resolved = `${serverUrl.replace(/\/$/, "")}${resolved}`;
    }

    const token = useRemoteDownloads ? pairedToken : standaloneToken;
    if (token) {
      const sep = resolved.includes("?") ? "&" : "?";
      resolved = `${resolved}${sep}t=${encodeURIComponent(token)}`;
    }

    return resolved;
  }, []);

  return {
    files,
    activeDownloads,
    loading,
    fetchDownloads,
    resolveDownloadUrl,
  };
}
