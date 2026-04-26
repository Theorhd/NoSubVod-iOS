import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Download as DownloadIcon,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  X,
} from "lucide-react";
import NSVPlayer, { NSVMediaSource } from "./components/NSVPlayer";
import { formatSize } from "../../shared/utils/formatters";
import { TopBar } from "./components/TopBar";
import { useDownloadsData } from "./hooks/useDownloadsData";
import { ActiveDownload, DownloadedFile } from "../../shared/types";
import "./styles/Downloads.css";

const formatDate = (value?: string) => {
  if (!value) return "Date inconnue";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "Date inconnue"
    : d.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

const getStatusDisplay = (status: any) => {
  if (status === "Queued")
    return {
      label: "En attente",
      icon: <Clock size={16} />,
      color: "var(--text-muted)",
    };
  if (status === "Downloading")
    return {
      label: "Téléchargement...",
      icon: <DownloadIcon size={16} className="spinning" />,
      color: "#9146ff",
    };
  if (status === "Finished")
    return {
      label: "Terminé",
      icon: <CheckCircle2 size={16} />,
      color: "#4ade80",
    };
  if (status && typeof status === "object" && "Error" in status)
    return {
      label: `Erreur: ${status.Error}`,
      icon: <AlertCircle size={16} />,
      color: "var(--error-red)",
    };
  return { label: "Inconnu", icon: null, color: "var(--text-muted)" };
};

const DownloadPlayer = React.memo(
  ({
    file,
    onClose,
    resolveUrl,
  }: {
    file: DownloadedFile;
    onClose: () => void;
    resolveUrl: (u: string) => string;
  }) => {
    const [error, setError] = useState<string | null>(null);

    const source = useMemo((): NSVMediaSource | null => {
      if (!file) return null;
      if (file.name.toLowerCase().endsWith(".ts"))
        return {
          src: resolveUrl(
            `/api/downloads/hls/${encodeURIComponent(file.name)}`,
          ),
          type: "application/x-mpegurl",
        };
      const url = resolveUrl(file.url);
      const low = file.name.toLowerCase();
      if (low.endsWith(".m3u8"))
        return { src: url, type: "application/x-mpegurl" };
      if (low.endsWith(".mp4")) return { src: url, type: "video/mp4" };
      if (low.endsWith(".webm")) return { src: url, type: "video/webm" };
      return { src: url };
    }, [file, resolveUrl]);

    if (!source) return null;

    return (
      <div className="download-player-shell card">
        <div className="download-player-head">
          <h2>{file.metadata?.title || file.name}</h2>
          <button onClick={onClose} className="queue-nav-btn" type="button">
            <X size={16} />
          </button>
        </div>
        <NSVPlayer
          key={file.name}
          source={source}
          title={file.metadata?.title || file.name}
          autoPlay
          streamType="on-demand"
          className="nsv-download-player"
          onError={() =>
            setError(
              "Lecture impossible: format non supporté ou fichier inaccessible.",
            )
          }
        />
        {error && <div className="error-text">{error}</div>}
      </div>
    );
  },
);
DownloadPlayer.displayName = "DownloadPlayer";

const QueueItem = React.memo(
  ({ dl, knownFile }: { dl: ActiveDownload; knownFile?: DownloadedFile }) => {
    const statusInfo = getStatusDisplay(dl.status);
    const statusName = typeof dl.status === "string" ? dl.status : "";
    const thumbnail =
      dl.progress > 0 ? knownFile?.metadata?.previewThumbnailURL || null : null;

    return (
      <article className="download-queue-card">
        <div className="download-queue-top">
          <div className="queue-thumb-wrap">
            {thumbnail ? (
              <img src={thumbnail} alt="" className="queue-thumb" />
            ) : (
              <div className="queue-thumb-placeholder">
                <DownloadIcon size={18} />
              </div>
            )}
          </div>
          <div className="download-queue-main">
            <div className="download-title-row">
              <h3>{dl.title}</h3>
              <span
                className="queue-status-dot download-status-text"
                style={
                  { "--status-color": statusInfo.color } as React.CSSProperties
                }
              >
                {statusName === "Downloading" ? (
                  <Pause size={14} />
                ) : (
                  statusInfo.icon
                )}
              </span>
            </div>
            <div className="download-queue-subline">
              {dl.current_time || "En cours"}
            </div>
            <div className="download-progress-track">
              <div
                className={`download-progress-fill ${statusName === "Downloading" ? "download-progress-fill-active" : ""}`}
                style={{
                  width: `${dl.progress}%`,
                }}
              />
            </div>
            <div className="download-queue-meta">
              <span>{dl.progress.toFixed(0)}%</span>
              <span
                className="download-status-text"
                style={
                  { "--status-color": statusInfo.color } as React.CSSProperties
                }
              >
                {statusInfo.label}
              </span>
            </div>
          </div>
        </div>
      </article>
    );
  },
);
QueueItem.displayName = "QueueItem";

const DownloadLibrary = React.memo(
  ({
    loading,
    files,
    handlePlay,
    formatDate,
    resolveDownloadUrl,
  }: {
    loading: boolean;
    files: DownloadedFile[];
    handlePlay: (file: DownloadedFile) => void;
    formatDate: (val?: string) => string;
    resolveDownloadUrl: (url: string) => string;
  }) => {
    if (loading && files.length === 0) {
      return <div className="status-line">Chargement...</div>;
    }

    if (files.length === 0) {
      return <div className="status-line">Aucun fichier trouvé.</div>;
    }

    return (
      <div className="download-library-grid">
        {files.map((file) => (
          <article key={file.name} className="download-library-card">
            <button
              type="button"
              className="download-library-thumb-btn"
              onClick={() => handlePlay(file)}
            >
              <div className="download-library-thumb-wrap">
                {file.metadata?.previewThumbnailURL ? (
                  <img
                    src={file.metadata.previewThumbnailURL}
                    alt=""
                    className="download-library-thumb"
                  />
                ) : (
                  <div className="download-library-thumb-placeholder">
                    <DownloadIcon size={22} />
                  </div>
                )}
                <span className="download-complete-chip">
                  <CheckCircle2 size={12} />
                  COMPLETED
                </span>
              </div>
            </button>
            <div className="download-library-body">
              <h3 className="download-file-title">
                {file.metadata?.title || file.name}
              </h3>
              <div className="download-meta-row">
                <span>
                  {file.metadata?.owner?.displayName || "Unknown channel"}
                </span>
                {file.metadata?.game?.name && (
                  <span>{file.metadata.game.name}</span>
                )}
              </div>
              <div className="download-meta-row muted">
                <span>Size: {formatSize(file.size)}</span>
                <span>Date: {formatDate(file.metadata?.createdAt)}</span>
              </div>
              <div className="download-card-actions">
                <button
                  onClick={() => handlePlay(file)}
                  className="download-card-btn primary"
                  type="button"
                >
                  <Play size={14} /> Lire
                </button>
                <a
                  href={resolveDownloadUrl(file.url)}
                  download={file.name}
                  className="download-card-btn secondary"
                >
                  <DownloadIcon size={14} /> Télécharger
                </a>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  },
);
DownloadLibrary.displayName = "DownloadLibrary";

export default function Downloads() {
  const { files, activeDownloads, loading, resolveDownloadUrl } =
    useDownloadsData();
  const [playingFile, setPlayingFile] = useState<DownloadedFile | null>(null);
  const queueRef = useRef<HTMLDivElement | null>(null);

  const knownVodById = useMemo(() => {
    const byId: Record<string, DownloadedFile> = {};
    files.forEach((f) => {
      if (f.metadata?.id) byId[f.metadata.id] = f;
    });
    return byId;
  }, [files]);

  const scrollQueue = useCallback((direction: "left" | "right") => {
    queueRef.current?.scrollBy({
      left: direction === "left" ? -360 : 360,
      behavior: "smooth",
    });
  }, []);

  const handlePlay = useCallback((file: DownloadedFile) => {
    setPlayingFile(file);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <>
      <TopBar mode="logo" title="Downloads" />
      <div className="container download-page">
        {playingFile && (
          <DownloadPlayer
            file={playingFile}
            onClose={() => setPlayingFile(null)}
            resolveUrl={resolveDownloadUrl}
          />
        )}

        {activeDownloads.length > 0 && (
          <section className="download-section">
            <div className="download-section-head">
              <h2>Download Queue</h2>
              <div className="queue-nav-group">
                <button
                  type="button"
                  className="queue-nav-btn"
                  onClick={() => scrollQueue("left")}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  className="queue-nav-btn"
                  onClick={() => scrollQueue("right")}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            <div className="download-queue-track" ref={queueRef}>
              {activeDownloads.map((dl) => (
                <QueueItem
                  key={dl.vod_id}
                  dl={dl}
                  knownFile={knownVodById[dl.vod_id]}
                />
              ))}
            </div>
          </section>
        )}

        <section className="download-section">
          <div className="download-section-head">
            <h2>Local Storage</h2>
          </div>
          <DownloadLibrary
            loading={loading}
            files={files}
            handlePlay={handlePlay}
            formatDate={formatDate}
            resolveDownloadUrl={resolveDownloadUrl}
          />
        </section>
      </div>
    </>
  );
}
