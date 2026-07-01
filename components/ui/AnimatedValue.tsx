"use client";

import { useEffect, useRef, useState } from "react";

interface AnimatedValueProps {
  value: number;
  format: (n: number) => string;
  duration?: number;
}

/** Animates a numeric KPI value with an ease-out count-up: from 0 on first mount, and from the
 *  previous value on subsequent changes (e.g. switching the principal filter or a new upload). */
export function AnimatedValue({ value, format, duration = 900 }: AnimatedValueProps) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      const id = requestAnimationFrame(() => {
        setDisplay(value);
        fromRef.current = value;
      });
      return () => cancelAnimationFrame(id);
    }

    const from = fromRef.current;
    const delta = value - from;
    const start = performance.now();
    let rafId: number;

    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + delta * eased);
      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [value, duration]);

  return <>{format(display)}</>;
}
