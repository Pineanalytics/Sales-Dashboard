"use client";

import { useEffect, useRef, useState } from "react";

// html5-qrcode reads what's physically encoded in a QR/barcode label. It
// cannot "discover" a value (like a laptop serial) that isn't printed as a
// scannable code on the device — see the guided-retrieval flow for that.
export function QrScanner({
  onDetected,
  onClose,
}: {
  onDetected: (value: string) => void;
  onClose: () => void;
}) {
  const elementId = useRef(`qr-scanner-${Math.random().toString(36).slice(2)}`);
  const scannerRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (cancelled) return;
      const scanner = new Html5Qrcode(elementId.current);
      scannerRef.current = scanner;

      Html5Qrcode.getCameras()
        .then((cameras) => {
          if (cancelled || cameras.length === 0) {
            setError("No camera found. Use manual entry instead.");
            return;
          }
          const cameraId = cameras[cameras.length - 1].id; // prefer back camera on mobile
          scanner
            .start(
              cameraId,
              { fps: 10, qrbox: { width: 250, height: 250 } },
              (decodedText: string) => {
                onDetected(decodedText);
              },
              () => {
                // per-frame "no code found" — expected noise, ignore
              }
            )
            .catch(() => setError("Could not start the camera. Use manual entry instead."));
        })
        .catch(() => setError("Camera access was denied. Use manual entry instead."));
    });

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      if (scanner) {
        scanner.stop().catch(() => {}).finally(() => scanner.clear());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-[var(--ink-600)]">
          Point the camera at the QR code or barcode
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-[var(--rust-600)] hover:underline"
        >
          Cancel
        </button>
      </div>
      <div id={elementId.current} className="w-full" />
      {error && <p className="mt-2 text-xs text-[var(--rust-600)]">{error}</p>}
    </div>
  );
}
