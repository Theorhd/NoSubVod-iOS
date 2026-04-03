import React, { useEffect, useRef } from "react";
import { Html5QrcodeScanner, Html5QrcodeScanType } from "html5-qrcode";

interface QRCodeReaderProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
}

export const QRCodeReader: React.FC<QRCodeReaderProps> = ({
  onScan,
  onClose,
}) => {
  const containerId = "nsv-qr-reader";
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    scannerRef.current = new Html5QrcodeScanner(
      containerId,
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
        rememberLastUsedCamera: true,
      },
      /* verbose= */ false,
    );

    scannerRef.current.render(
      (decodedText) => {
        if (scannerRef.current) {
          scannerRef.current.clear();
        }
        onScan(decodedText);
      },
      (_error) => {
        // ignore periodic scan failures
      },
    );

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(console.error);
      }
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
