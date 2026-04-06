import React, { useEffect, useRef, useState } from "react";

type Html5QrcodeModule = typeof import("html5-qrcode");
type Html5QrcodeScannerType = InstanceType<
  Html5QrcodeModule["Html5QrcodeScanner"]
>;

interface QRCodeReaderProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
}

export const QRCodeReader: React.FC<QRCodeReaderProps> = ({
  onScan,
  onClose,
}) => {
  const containerId = "nsv-qr-reader";
  const scannerRef = useRef<Html5QrcodeScannerType | null>(null);
  const [scannerStatus, setScannerStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");

  useEffect(() => {
    let disposed = false;
    let activeScanner: Html5QrcodeScannerType | null = null;

    const setupScanner = async () => {
      try {
        setScannerStatus("loading");
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

        <div id={containerId} style={{ width: "100%", color: "#000" }}></div>

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
