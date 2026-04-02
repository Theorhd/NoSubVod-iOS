import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { QrCode, KeyRound, ArrowRight, ShieldCheck } from 'lucide-react';
import { safeStorageSet } from '../../shared/utils/storage';
import { canUseGetUserMedia } from './utils/capabilities';

type CameraStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'unsupported' | 'insecure';

export default function Login() {
  const [token, setToken] = useState('');
  const [isMobile, setIsMobile] = useState(globalThis.innerWidth <= 860);
  const [error, setError] = useState('');
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerStartedRef = useRef(false);
  const requestInFlightRef = useRef(false);
  const preferredCameraIdRef = useRef<string | null>(null);
  const hasHandledQrRef = useRef(false);

  const isRearCameraLabel = (label: string) => {
    const lower = label.toLowerCase();
    const hasRearHint =
      lower.includes('back') ||
      lower.includes('rear') ||
      lower.includes('environment') ||
      lower.includes('world') ||
      lower.includes('arriere') ||
      lower.includes('arrière');
    const hasFrontHint =
      lower.includes('front') ||
      lower.includes('user') ||
      lower.includes('selfie') ||
      lower.includes('facetime') ||
      lower.includes('avant');
    return hasRearHint && !hasFrontHint;
  };

  const handleTokenSubmit = useCallback((rawValue: string) => {
    const value = rawValue.trim();
    if (!value) return false;

    let tokenValue = value;
    try {
      const url = new URL(value);
      tokenValue = url.searchParams.get('t')?.trim() || value;
    } catch {
      const tokenRegex = /[?&]t=([^&#]+)/i;
      const match = tokenRegex.exec(value);
      if (match?.[1]) {
        tokenValue = decodeURIComponent(match[1]).trim();
      }
    }

    if (!tokenValue) return false;

    safeStorageSet(sessionStorage, 'nsv_token', tokenValue);
    safeStorageSet(localStorage, 'nsv_token', tokenValue);
    globalThis.location.reload();
    return true;
  }, []);

  useEffect(() => {
    const handleResize = () => setIsMobile(globalThis.innerWidth <= 860);
    globalThis.addEventListener('resize', handleResize);
    return () => globalThis.removeEventListener('resize', handleResize);
  }, []);

  const stopScannerSafely = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;

    try {
      // stop() can throw synchronously when scanner is not in running/paused state.
      await Promise.resolve(scanner.stop());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes('cannot stop')) {
        console.error('Failed to stop QR scanner', err);
      }
    }

    scannerStartedRef.current = false;
    scannerRef.current = null;
  }, []);

  const startScanner = useCallback(async () => {
    if (scannerStartedRef.current) return;

    const html5QrCode = new Html5Qrcode('qr-reader');
    scannerRef.current = html5QrCode;

    let cameraConfig: { facingMode: string } | string = { facingMode: 'environment' };

    try {
      const cameras = await Html5Qrcode.getCameras();
      if (cameras.length > 0) {
        const preferredCamera = preferredCameraIdRef.current
          ? cameras.find((camera) => camera.id === preferredCameraIdRef.current)
          : null;
        let preferredRearCamera: typeof preferredCamera = null;
        if (
          preferredCamera &&
          (!preferredCamera.label || isRearCameraLabel(preferredCamera.label))
        ) {
          preferredRearCamera = preferredCamera;
        }
        const rearCamera = cameras.find((camera) => isRearCameraLabel(camera.label));

        cameraConfig = preferredRearCamera?.id ?? rearCamera?.id ?? cameras[0].id;
      }
    } catch {
      // Keep facingMode fallback for browsers that block camera enumeration before permission.
    }

    await html5QrCode.start(
      cameraConfig,
      {
        fps: globalThis.innerHeight > globalThis.innerWidth ? 16 : 12,
        aspectRatio: globalThis.innerHeight > globalThis.innerWidth ? 0.75 : 1.333333,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          // Keep the scan box adaptive so QR detection works in portrait and landscape.
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const portrait = viewfinderHeight > viewfinderWidth;
          const boxRatio = portrait ? 0.9 : 0.72;
          const boxSize = Math.max(portrait ? 190 : 160, Math.floor(minEdge * boxRatio));
          return { width: boxSize, height: boxSize };
        },
      },
      (decodedText) => {
        if (hasHandledQrRef.current) return;
        hasHandledQrRef.current = true;

        try {
          void stopScannerSafely();
          const submitted = handleTokenSubmit(decodedText);
          if (!submitted) {
            hasHandledQrRef.current = false;
          }
        } catch {
          hasHandledQrRef.current = false;
        }
      },
      (_errorMessage) => {
        // Ignore typical scanning errors.
      }
    );

    scannerStartedRef.current = true;
  }, [handleTokenSubmit, stopScannerSafely]);

  const requestCameraAccessAndStart = useCallback(async () => {
    if (!isMobile || requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    hasHandledQrRef.current = false;
    setError('');
    setCameraStatus('requesting');

    try {
      // On mobile browsers, camera access requires secure context (HTTPS/localhost).
      if (!globalThis.isSecureContext) {
        setCameraStatus('insecure');
        setError(
          'Camera bloquee: cette page est ouverte en HTTP. Utilisez HTTPS (ou localhost) pour autoriser la camera.'
        );
        return;
      }

      if (!canUseGetUserMedia()) {
        setCameraStatus('unsupported');
        setError('Votre navigateur ne supporte pas la camera. Utilisez la saisie du token.');
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: 'environment' } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
      }

      const [videoTrack] = stream.getVideoTracks();
      const grantedDeviceId = videoTrack?.getSettings?.().deviceId;
      const grantedFacingMode = videoTrack?.getSettings?.().facingMode;
      preferredCameraIdRef.current =
        grantedFacingMode === 'environment' ? (grantedDeviceId ?? null) : null;

      stream.getTracks().forEach((track) => track.stop());

      setCameraStatus('granted');
      await startScanner();
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      const denied = name === 'NotAllowedError' || name === 'PermissionDeniedError';

      if (denied) {
        setCameraStatus('denied');
        setError(
          'Acces camera refuse. Appuyez sur le bouton pour reessayer ou autorisez la camera dans les reglages du navigateur.'
        );
      } else {
        setCameraStatus('denied');
        setError("Impossible d'acceder a la camera.");
      }

      console.error('Failed to request camera permission or start scanner', err);
      await stopScannerSafely();
    } finally {
      requestInFlightRef.current = false;
    }
  }, [isMobile, startScanner, stopScannerSafely]);

  useEffect(() => {
    if (isMobile) {
      void requestCameraAccessAndStart();

      return () => {
        void stopScannerSafely();
      };
    }

    setCameraStatus('idle');
    setError('');
    void stopScannerSafely();
  }, [isMobile, requestCameraAccessAndStart, stopScannerSafely]);

  let cameraActionLabel = 'Autoriser la camera';
  if (cameraStatus === 'requesting') {
    cameraActionLabel = 'Demande en cours...';
  } else if (cameraStatus === 'insecure') {
    cameraActionLabel = 'HTTPS requis';
  } else if (cameraStatus === 'denied') {
    cameraActionLabel = "Reessayer l'acces camera";
  }

  let cameraStatusLabel = 'Initialisation camera';
  if (cameraStatus === 'requesting') {
    cameraStatusLabel = 'Demande permission...';
  } else if (cameraStatus === 'granted') {
    cameraStatusLabel = 'Camera active';
  } else if (cameraStatus === 'denied') {
    cameraStatusLabel = 'Permission refusee';
  } else if (cameraStatus === 'unsupported') {
    cameraStatusLabel = 'Camera indisponible';
  } else if (cameraStatus === 'insecure') {
    cameraStatusLabel = 'HTTPS requis';
  }

  return (
    <div className="login-screen">
      {isMobile ? (
        <div className="login-mobile-layout">
          <div className="qr-section">
            <div className="qr-header">
              <QrCode size={24} className="text-primary" />
              <h2>Scanner le QR Code</h2>
            </div>

            <div className={`camera-status-chip status-${cameraStatus}`}>{cameraStatusLabel}</div>

            <div id="qr-reader" className="qr-reader-container"></div>
            <div className="scan-frame" aria-hidden="true">
              <span className="scan-corner top-left"></span>
              <span className="scan-corner top-right"></span>
              <span className="scan-corner bottom-left"></span>
              <span className="scan-corner bottom-right"></span>
            </div>

            <p className="scan-hint">Placez le QR code au centre du cadre</p>

            {cameraStatus !== 'granted' && (
              <div className="camera-permission-overlay">
                <p className="camera-permission-title">Autorisation camera requise</p>
                <p className="camera-permission-text">
                  Sur iOS et Android, acceptez la demande pour scanner le QR code.
                </p>
                <button
                  type="button"
                  className="camera-permission-btn"
                  onClick={() => void requestCameraAccessAndStart()}
                  disabled={
                    cameraStatus === 'requesting' ||
                    cameraStatus === 'unsupported' ||
                    cameraStatus === 'insecure'
                  }
                >
                  {cameraActionLabel}
                </button>
              </div>
            )}
            {error && <p className="error-text">{error}</p>}
          </div>
          <div className="token-section">
            <div className="token-input-card">
              <div className="token-header">
                <KeyRound size={20} className="text-muted" />
                <h3>Ou saisir le token</h3>
              </div>
              <div className="token-input-wrapper">
                <input
                  type="password"
                  placeholder="Token secret..."
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTokenSubmit(token)}
                />
                <button className="submit-btn" onClick={() => handleTokenSubmit(token)}>
                  <ArrowRight size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="login-desktop-layout">
          <div className="desktop-login-card">
            <div className="brand-logo">
              <ShieldCheck size={48} className="brand-icon" />
              <h1>NoSubVod</h1>
            </div>
            <p className="login-subtitle">Veuillez vous authentifier pour accéder au portail.</p>
            <div className="token-input-wrapper-desktop">
              <label htmlFor="desktop-token-input">Token d&apos;accès</label>
              <div className="input-with-btn">
                <input
                  id="desktop-token-input"
                  type="password"
                  placeholder="Saisissez votre token de sécurité"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTokenSubmit(token)}
                  autoFocus
                />
                <button className="action-btn" onClick={() => handleTokenSubmit(token)}>
                  Connexion <ArrowRight size={18} style={{ marginLeft: 8 }} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
