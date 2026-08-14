"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SignaturePadHandle {
  isEmpty: () => boolean;
  toDataURL: () => string;
  clear: () => void;
}

// Mouse, touch, and stylus input are all handled by signature_pad itself via
// pointer events — no separate code paths needed per input type.
export const SignaturePad = forwardRef<SignaturePadHandle>(function SignaturePad(
  _props,
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let pad: any;
    import("signature_pad").then(({ default: SignaturePadLib }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      function resize() {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas!.width = canvas!.offsetWidth * ratio;
        canvas!.height = canvas!.offsetHeight * ratio;
        canvas!.getContext("2d")?.scale(ratio, ratio);
        pad?.clear();
      }

      pad = new SignaturePadLib(canvas, {
        backgroundColor: "rgb(255,255,255)",
        penColor: "rgb(11,11,11)",
      });
      padRef.current = pad;
      resize();
      window.addEventListener("resize", resize);
      setReady(true);

      return () => window.removeEventListener("resize", resize);
    });
  }, []);

  useImperativeHandle(ref, () => ({
    isEmpty: () => padRef.current?.isEmpty() ?? true,
    toDataURL: () => padRef.current?.toDataURL("image/png") ?? "",
    clear: () => padRef.current?.clear(),
  }));

  return (
    <div>
      <div className="rounded-md border border-[var(--line)] bg-white">
        <canvas ref={canvasRef} className="w-full h-40 touch-none rounded-md" />
      </div>
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          onClick={() => padRef.current?.clear()}
          disabled={!ready}
          className="text-xs font-medium text-[var(--ink-600)] hover:text-[var(--pine-700)] disabled:opacity-50"
        >
          Clear signature
        </button>
      </div>
    </div>
  );
});
