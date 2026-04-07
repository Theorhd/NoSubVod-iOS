import React, { useEffect, useRef, useState } from "react";

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
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
          backgroundColor: "#18181b",
          borderRadius: "8px",
          padding: "16px",
          boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "16px",
          }}
        >
          <h3 style={{ margin: 0, color: "#fff" }}>Scan QR Code</h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#a3a3a3",
              fontSize: "24px",
              cursor: "pointer",
              lineHeight: "1",
            }}
          >
            &times;
          </button>
        </div>

        {scannerStatus === "loading" && (
          <p
            style={{
              marginBottom: "12px",
              color: "#a3a3a3",
              fontSize: "14px",
              textAlign: "center",
            }}
          >
            Initialisation du scanner...
          </p>
        )}

        {scannerStatus === "error" && (
          <p
            style={{
              marginBottom: "12px",
              color: "#ef4444",
              fontSize: "14px",
              textAlign: "center",
            }}
          >
            Impossible de charger le scanner QR.
          </p>
        )}

        {useNative ? (
          <div
            style={{
              position: "relative",
              width: "100%",
              borderRadius: "8px",
              overflow: "hidden",
              aspectRatio: "1",
            }}
          >
            <video
              ref={videoRef}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "200px",
                height: "200px",
                border: "2px solid rgba(143, 87, 255, 0.8)",
                boxShadow: "0 0 0 4000px rgba(0,0,0,0.5)",
                pointerEvents: "none",
              }}
            />
          </div>
        ) : (
          <div id={containerId} style={{ width: "100%", color: "#000" }}></div>
        )}

        <p
          style={{
            marginTop: "16px",
            color: "#a3a3a3",
            fontSize: "14px",
            textAlign: "center",
          }}
        >
          Pointez votre caméra vers le QR code sur votre application Desktop.
        </p>
      </div>
    </div>
  );
};
