import { useCallback, useEffect, useState } from "react";
import { DownloadedFile, ActiveDownload } from "../../../shared/types";
import { useInterval } from "../../../shared/hooks/useInterval";

const DEBUG_DOWNLOADS = false;

export function useDownloadsData() {
  const [files, setFiles] = useState<DownloadedFile[]>([]);
  const [activeDownloads, setActiveDownloads] = useState<ActiveDownload[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined"
      ? true
      : document.visibilityState === "visible",
  );

  const fetchDownloads = useCallback(async () => {
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
      }

      if (activeRes.ok) {
        setActiveDownloads((await activeRes.json()) as ActiveDownload[]);
      }
    } catch (error) {
      if (DEBUG_DOWNLOADS) {
        console.error("[Downloads] Failed to fetch downloads", error);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDownloads();
  }, [fetchDownloads]);

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsPageVisible(document.visibilityState === "visible");
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  let downloadsPollingDelay = 5000;
  if (isPageVisible === false) {
    downloadsPollingDelay = 12000;
  } else if (activeDownloads.length > 0) {
    downloadsPollingDelay = 2000;
  }

  useInterval(fetchDownloads, downloadsPollingDelay);

  const resolveDownloadUrl = useCallback((url: string) => {
    if (!url) return "";

    let resolved: string;
    if (url.startsWith("/api/")) resolved = url;
    else if (url.startsWith("/shared-downloads/")) resolved = `/api${url}`;
    else if (url.startsWith("/")) resolved = `/api${url}`;
    else resolved = `/api/${url}`;

    const token =
      sessionStorage.getItem("nsv_token") || localStorage.getItem("nsv_token");
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
