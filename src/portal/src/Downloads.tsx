import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Download as DownloadIcon,
  AlertCircle,
  CheckCircle2,
  Clock,
  Play,
  X,
  Trash2,
  MoreVertical,
} from "lucide-react";
import NSVPlayer, { NSVMediaSource } from "./components/NSVPlayer";
import { formatSize, formatSafeClock } from "../../shared/utils/formatters";
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
  ({
    dl,
    knownFile,
    cancelDownload,
  }: {
    dl: ActiveDownload;
    knownFile?: DownloadedFile;
    cancelDownload: (id: string) => void;
  }) => {
    const statusInfo = getStatusDisplay(dl.status);
    const statusName = typeof dl.status === "string" ? dl.status : "";
    const thumbnail =
      dl.progress > 0 ? knownFile?.metadata?.previewThumbnailURL || null : null;

    return (
      <article
        className="download-queue-card"
        style={{ "--progress-width": `${dl.progress}%` } as React.CSSProperties}
      >
        <div className="queue-thumb-wrap">
          {thumbnail ? (
            <img src={thumbnail} alt="" className="queue-thumb" />
          ) : (
            <DownloadIcon size={20} color="var(--vault-muted)" />
          )}
        </div>
        <div className="download-queue-main">
          <div className="download-title-row">
            <h3>{dl.title}</h3>
            <div className="queue-actions">
              <span className="queue-percent">{dl.progress.toFixed(0)}%</span>
              <button
                className="queue-cancel-btn"
                title="Annuler"
                onClick={() => cancelDownload(dl.vod_id)}
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="download-queue-subline">
            {statusInfo.icon} {statusInfo.label} •{" "}
            {dl.current_time || "En cours"}
          </div>
        </div>
      </article>
    );
  },
);
QueueItem.displayName = "QueueItem";

const DownloadCard = ({
  file,
  handlePlay,
  formatDate,
  resolveDownloadUrl,
  deleteDownload,
}: {
  file: DownloadedFile;
  handlePlay: (file: DownloadedFile) => void;
  formatDate: (val?: string) => string;
  resolveDownloadUrl: (url: string) => string;
  deleteDownload: (name: string) => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  return (
    <article className="download-library-card">
      <button
        type="button"
        className="download-library-thumb-btn"
        onClick={() => handlePlay(file)}
      >
        {file.metadata?.previewThumbnailURL ? (
          <img
            src={file.metadata.previewThumbnailURL}
            alt=""
            className="download-library-thumb"
          />
        ) : (
          <div
            className="download-library-thumb"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <DownloadIcon size={32} color="var(--vault-muted)" />
          </div>
        )}
        <div className="download-play-overlay">
          <Play fill="white" size={24} />
        </div>
        <span className="download-complete-chip">
          <CheckCircle2 size={12} />
          COMPLETED
        </span>
        {file.metadata?.lengthSeconds ? (
          <span className="download-duration-chip">
            {formatSafeClock(file.metadata.lengthSeconds)}
          </span>
        ) : null}
      </button>
      <div className="download-library-body">
        <div className="download-title-row">
          <h3 className="download-file-title">
            {file.metadata?.title || file.name}
          </h3>
          <div className="download-card-actions-wrapper" ref={menuRef}>
            <button
              type="button"
              className="download-more-btn"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <MoreVertical size={18} />
            </button>
            <div className={`vault-context-menu ${menuOpen ? "open" : ""}`}>
              <button
                type="button"
                className="vault-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  handlePlay(file);
                }}
              >
                <Play size={16} /> Lire
              </button>
              <a
                href={resolveDownloadUrl(file.url)}
                download={file.name}
                className="vault-menu-item"
                onClick={() => setMenuOpen(false)}
              >
                <DownloadIcon size={16} /> Fichier source
              </a>
              <button
                type="button"
                className="vault-menu-item danger"
                onClick={() => {
                  setMenuOpen(false);
                  deleteDownload(file.name);
                }}
              >
                <Trash2 size={16} /> Supprimer
              </button>
            </div>
          </div>
        </div>
        <div className="download-meta-row muted">
          <span>{file.metadata?.owner?.displayName || "Unknown channel"}</span>
          <span>{formatSize(file.size)}</span>
        </div>
        <div className="download-meta-row muted">
          <span>{file.metadata?.game?.name || ""}</span>
          <span>{formatDate(file.metadata?.createdAt)}</span>
        </div>
      </div>
    </article>
  );
};

const DownloadLibrary = React.memo(
  ({
    loading,
    files,
    handlePlay,
    formatDate,
    resolveDownloadUrl,
    deleteDownload,
  }: {
    loading: boolean;
    files: DownloadedFile[];
    handlePlay: (file: DownloadedFile) => void;
    formatDate: (val?: string) => string;
    resolveDownloadUrl: (url: string) => string;
    deleteDownload: (name: string) => void;
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
          <DownloadCard
            key={file.name}
            file={file}
            handlePlay={handlePlay}
            formatDate={formatDate}
            resolveDownloadUrl={resolveDownloadUrl}
            deleteDownload={deleteDownload}
          />
        ))}
      </div>
    );
  },
);
DownloadLibrary.displayName = "DownloadLibrary";

export default function Downloads() {
  const {
    files,
    activeDownloads,
    loading,
    resolveDownloadUrl,
    deleteDownload,
    cancelDownload,
  } = useDownloadsData();
  const [playingFile, setPlayingFile] = useState<DownloadedFile | null>(null);

  const knownVodById = useMemo(() => {
    const byId: Record<string, DownloadedFile> = {};
    files.forEach((f) => {
      if (f.metadata?.id) byId[f.metadata.id] = f;
    });
    return byId;
  }, [files]);

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
            </div>
            <div className="download-queue-track">
              {activeDownloads.map((dl) => (
                <QueueItem
                  key={dl.vod_id}
                  dl={dl}
                  knownFile={knownVodById[dl.vod_id]}
                  cancelDownload={cancelDownload}
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
            deleteDownload={deleteDownload}
          />
        </section>
      </div>
    </>
  );
}
