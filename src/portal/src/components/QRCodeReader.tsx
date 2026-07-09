import React, { useEffect, useRef, useState } from "react";
import styles from "./QRCodeReader.module.scss";

type Html5QrcodeModule = typeof import("html5-qrcode");
type Html5QrcodeScannerType = InstanceType<
  Html5QrcodeModule["Html5QrcodeScanner"]
>;

interface QRCodeReaderProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
}

// Typings for native BarcodeDetector API
declare global {
  class BarcodeDetector {
    constructor(options?: { formats: string[] });
    static getSupportedFormats(): Promise<string[]>;
    detect(image: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
  }
}

export const QRCodeReader: React.FC<QRCodeReaderProps> = ({
  onScan,
  onClose,
}) => {
  const containerId = "nsv-qr-reader";
  const scannerRef = useRef<Html5QrcodeScannerType | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanRafRef = useRef<number | null>(null);

  const [scannerStatus, setScannerStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [useNative, setUseNative] = useState(false);

  useEffect(() => {
    let disposed = false;
    let activeScanner: Html5QrcodeScannerType | null = null;

    const stopNativeScanner = () => {
      if (scanRafRef.current !== null) {
        cancelAnimationFrame(scanRafRef.current);
        scanRafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    const setupScanner = async () => {
      try {
        setScannerStatus("loading");

        // 1. Try Native BarcodeDetector (iOS 14.3+, modern Chrome/Edge)
        if ("BarcodeDetector" in globalThis) {
          const formats = await BarcodeDetector.getSupportedFormats();
          if (formats.includes("qr_code")) {
            setUseNative(true);
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: "environment" },
            });
            if (disposed) {
              stream.getTracks().forEach((track) => track.stop());
              return;
            }

            streamRef.current = stream;
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
              videoRef.current.setAttribute("playsinline", "true"); // required for iOS
              await videoRef.current.play();
            }

            const detector = new BarcodeDetector({ formats: ["qr_code"] });

            const scanFrame = async () => {
              if (
                disposed ||
                !videoRef.current ||
                videoRef.current.readyState < 2
              ) {
                if (!disposed) {
                  scanRafRef.current = requestAnimationFrame(scanFrame);
                }
                return;
              }

              try {
                const barcodes = await detector.detect(videoRef.current);
                if (barcodes.length > 0 && barcodes[0].rawValue) {
                  onScan(barcodes[0].rawValue);
                  return; // Stop scanning on success
                }
              } catch {
                // Ignore detection errors for this frame
              }

              if (!disposed) {
                scanRafRef.current = requestAnimationFrame(scanFrame);
              }
            };

            scanRafRef.current = requestAnimationFrame(scanFrame);
            setScannerStatus("ready");
            return;
          }
        }

        // 2. Fallback to html5-qrcode for unsupported browsers
        setUseNative(false);
        const { Html5QrcodeScanner, Html5QrcodeScanType } =
          await import("html5-qrcode");
        if (disposed) return;

        const scanner = new Html5QrcodeScanner(
          containerId,
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
            rememberLastUsedCamera: true,
          },
          /* verbose= */ false,
        );

        scannerRef.current = scanner;
        activeScanner = scanner;

        scanner.render(
          (decodedText) => {
            if (scannerRef.current) {
              void scannerRef.current.clear();
            }
            onScan(decodedText);
          },
          (_error) => {
            // ignore periodic scan failures
          },
        );

        setScannerStatus("ready");
      } catch (error) {
        if (disposed) return;
        setScannerStatus("error");
        console.error("[QRCodeReader] Failed to initialize scanner", error);
      }
    };

    void setupScanner();

    return () => {
      disposed = true;
      stopNativeScanner();

      const scanner = activeScanner ?? scannerRef.current;
      if (scanner) {
        scanner.clear().catch(console.error);
      }
      scannerRef.current = null;
    };
  }, [onScan]);

  return (
    <div className={styles["extracted-style-1"]}>
      <div className={styles["extracted-style-2"]}>
        <div className={styles["extracted-style-3"]}>
          <h3 className={styles["extracted-style-4"]}>Scan QR Code</h3>
          <button onClick={onClose} className={styles["extracted-style-5"]}>
            &times;
          </button>
        </div>

        {scannerStatus === "loading" && (
          <p className={styles["extracted-style-6"]}>
            Initialisation du scanner...
          </p>
        )}

        {scannerStatus === "error" && (
          <p className={styles["extracted-style-7"]}>
            Impossible de charger le scanner QR.
          </p>
        )}

        {useNative ? (
          <div className={styles["extracted-style-8"]}>
            <video ref={videoRef} className={styles["extracted-style-9"]}>
              <track kind="captions" />
            </video>
            <div className={styles["extracted-style-10"]} />
          </div>
        ) : (
          <div id={containerId} className={styles["extracted-style-11"]}></div>
        )}

        <p className={styles["extracted-style-12"]}>
          Pointez votre caméra vers le QR code sur votre application Desktop.
        </p>
      </div>
    </div>
  );
};
