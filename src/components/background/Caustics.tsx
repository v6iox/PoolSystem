"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient water-caustics shimmer. Renders layered interference waves into a
 * tiny offscreen canvas (~160px wide) that CSS upscales with blur — GPU-cheap,
 * ~24fps, pauses when the tab is hidden or the user prefers reduced motion.
 */
export function Caustics({ paused = false }: { paused?: boolean }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const W = 176;
    const H = 99;
    canvas.width = W;
    canvas.height = H;

    let raf = 0;
    let last = 0;
    let t = Math.random() * 100;

    const draw = (nowMs: number): void => {
      raf = requestAnimationFrame(draw);
      if (nowMs - last < 41) return; // ~24fps
      last = nowMs;
      t += 0.0065;

      const styles = getComputedStyle(document.documentElement);
      const isLight = document.documentElement.getAttribute("data-mode") === "light";
      const accentH = Number(styles.getPropertyValue("--accent-h") || 187);

      const image = ctx.createImageData(W, H);
      const data = image.data;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const u = x / W;
          const v = y / H;
          // Two traveling wave sets interfering — the classic caustics look.
          const a =
            Math.sin(u * 9 + t * 2.1 + Math.sin(v * 7 - t * 1.3) * 1.4) +
            Math.sin(v * 11 - t * 1.7 + Math.sin(u * 6 + t) * 1.2);
          const b =
            Math.sin((u + v) * 8 - t * 1.1 + Math.sin(u * 12 - t * 2.3) * 0.8) +
            Math.sin((u - v) * 10 + t * 1.9);
          const bright = Math.pow(Math.max(0, (a + b + 4) / 8), 3.2);
          const i = (y * W + x) * 4;
          if (isLight) {
            const c = bright * 90;
            data[i] = 255 - c * 0.5;
            data[i + 1] = 255 - c * 0.15;
            data[i + 2] = 255;
            data[i + 3] = bright * 46;
          } else {
            const hueShift = (accentH - 187) / 187;
            data[i] = bright * (55 + hueShift * 40);
            data[i + 1] = bright * 190;
            data[i + 2] = bright * 215;
            data[i + 3] = bright * 58;
          }
        }
      }
      ctx.putImageData(image, 0, 0);
    };

    const stop = (): void => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const maybeStart = (): void => {
      stop();
      if (!paused && !reduced.matches && !document.hidden) {
        raf = requestAnimationFrame(draw);
      }
    };

    maybeStart();
    document.addEventListener("visibilitychange", maybeStart);
    reduced.addEventListener("change", maybeStart);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", maybeStart);
      reduced.removeEventListener("change", maybeStart);
    };
  }, [paused]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="pool-gradient absolute inset-0" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full opacity-70"
        style={{ filter: "blur(26px)", transform: "scale(1.12)" }}
      />
    </div>
  );
}
