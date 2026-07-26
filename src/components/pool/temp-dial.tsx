"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { NumberTicker } from "@/components/ui/number-ticker";

/**
 * The signature Moonpool element: a liquid-fill setpoint ring.
 * Water level tracks current temp; the surface gently ripples while the
 * heater is firing and settles glass-smooth at temperature. The outer ring
 * shows the setpoint and supports drag-to-set. Reduced motion = static fill.
 */

export interface TempDialProps {
  label: string;
  temp: number | null;
  setPoint: number;
  min: number;
  max: number;
  heating: boolean;
  /** solar heat shows a warmer ring hue */
  heatSource?: "heater" | "solar" | "off";
  units: "F" | "C";
  disabled?: boolean;
  size?: number;
  onSetPoint?: (value: number) => void;
  className?: string;
}

const TAU = Math.PI * 2;
/** Arc spans 270°, from 135° (bottom-left) clockwise to 45° (bottom-right). */
const ARC_START = (3 / 4) * Math.PI;
const ARC_SPAN = (3 / 2) * Math.PI;

function valueToAngle(value: number, min: number, max: number): number {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return ARC_START + t * ARC_SPAN;
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = to - from > Math.PI ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function TempDial({
  label,
  temp,
  setPoint,
  min,
  max,
  heating,
  heatSource = "heater",
  units,
  disabled = false,
  size = 240,
  onSetPoint,
  className,
}: TempDialProps): React.JSX.Element {
  const reduced = useReducedMotion();
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const wavePathRef = useRef<SVGPathElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wasHeating = useRef(heating);
  const phaseRef = useRef(Math.random() * TAU);

  const displaySetPoint = dragValue ?? setPoint;
  const half = size / 2;
  const ringR = half - 10;
  const waveTop = useRef(0);

  // Water level: fraction of the dial the liquid fills, from temp within range.
  const levelFrac = temp === null ? 0 : Math.max(0.08, Math.min(0.92, (temp - min) / (max - min)));
  waveTop.current = size * (1 - levelFrac);

  // Ripple animation while heating.
  useEffect(() => {
    const path = wavePathRef.current;
    if (!path) return;
    let raf = 0;
    let last = 0;
    const amplitudeTarget = heating && !reduced ? 3.2 : 0;
    let amplitude = heating ? 0 : 0;

    const draw = (nowMs: number): void => {
      raf = requestAnimationFrame(draw);
      if (nowMs - last < 33) return;
      last = nowMs;
      phaseRef.current += 0.09;
      amplitude += (amplitudeTarget - amplitude) * 0.04;
      const top = waveTop.current;
      const phase = phaseRef.current;
      let d = `M 0 ${size} L 0 ${top.toFixed(1)}`;
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * size;
        const y = top + Math.sin(phase + i * 0.9) * amplitude + Math.sin(phase * 1.7 + i * 0.5) * amplitude * 0.5;
        d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      d += ` L ${size} ${size} Z`;
      path.setAttribute("d", d);
      // When settled and not heating, stop animating entirely.
      if (!heating && amplitude < 0.05 && amplitudeTarget === 0) {
        cancelAnimationFrame(raf);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [heating, reduced, size, temp]);

  // Celebration ripple burst when reaching setpoint while heating.
  useEffect(() => {
    if (wasHeating.current && !heating && temp !== null && temp >= setPoint - 0.5) {
      setCelebrate(true);
      const timer = window.setTimeout(() => setCelebrate(false), 1400);
      return () => window.clearTimeout(timer);
    }
    wasHeating.current = heating;
    return undefined;
  }, [heating, temp, setPoint]);

  const handleDrag = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): void => {
      if (disabled || !onSetPoint) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      let angle = Math.atan2(y, x);
      if (angle < ARC_START - Math.PI * 2) angle += TAU;
      // Normalize into [ARC_START, ARC_START+SPAN] taking the wrap into account.
      let a = angle;
      while (a < ARC_START) a += TAU;
      if (a > ARC_START + ARC_SPAN) return; // dead zone at the bottom
      const t = (a - ARC_START) / ARC_SPAN;
      const value = Math.round(min + t * (max - min));
      setDragValue(value);
    },
    [disabled, onSetPoint, min, max]
  );

  const commitDrag = useCallback((): void => {
    if (dragValue !== null && dragValue !== setPoint) onSetPoint?.(dragValue);
    setDragValue(null);
  }, [dragValue, setPoint, onSetPoint]);

  const nudge = useCallback(
    (delta: number): void => {
      const next = Math.max(min, Math.min(max, setPoint + delta));
      if (next !== setPoint) onSetPoint?.(next);
    },
    [min, max, setPoint, onSetPoint]
  );

  const ringColor = heating ? (heatSource === "solar" ? "var(--warn)" : "var(--heat)") : "var(--accent)";
  const setAngle = valueToAngle(displaySetPoint, min, max);
  const tempAngle = valueToAngle(temp ?? min, min, max);
  const [setX, setY] = polar(half, half, ringR, setAngle);
  const gradId = `dial-fill-${label.replace(/\W/g, "")}`;

  return (
    <div className={cn("relative flex flex-col items-center", className)} style={{ width: size }}>
      <svg
        ref={svgRef}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn("select-none touch-none", onSetPoint && !disabled && "cursor-pointer")}
        onPointerDown={(e) => {
          if (disabled || !onSetPoint) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          handleDrag(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) handleDrag(e);
        }}
        onPointerUp={commitDrag}
        role={onSetPoint ? "slider" : "img"}
        aria-label={`${label} setpoint`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={displaySetPoint}
        tabIndex={onSetPoint && !disabled ? 0 : -1}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowRight") nudge(1);
          if (e.key === "ArrowDown" || e.key === "ArrowLeft") nudge(-1);
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ringColor} stopOpacity="0.34" />
            <stop offset="100%" stopColor={ringColor} stopOpacity="0.06" />
          </linearGradient>
          <clipPath id={`${gradId}-clip`}>
            <circle cx={half} cy={half} r={ringR - 12} />
          </clipPath>
        </defs>

        {/* liquid fill, clipped to the inner circle */}
        <g clipPath={`url(#${gradId}-clip)`}>
          <circle cx={half} cy={half} r={ringR - 12} fill="var(--abyss)" opacity="0.55" />
          <path ref={wavePathRef} fill={`url(#${gradId})`} />
        </g>

        {/* track + value arc */}
        <path
          d={arcPath(half, half, ringR, ARC_START, ARC_START + ARC_SPAN)}
          fill="none"
          stroke="var(--line-bright)"
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.5"
        />
        {temp !== null && (
          <path
            d={arcPath(half, half, ringR, ARC_START, Math.max(tempAngle, ARC_START + 0.02))}
            fill="none"
            stroke={ringColor}
            strokeWidth="5"
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 6px ${ringColor})`, transition: "stroke 400ms" }}
          />
        )}

        {/* setpoint handle */}
        {onSetPoint && (
          <g style={{ transition: dragValue === null ? "all 200ms" : "none" }}>
            <circle cx={setX} cy={setY} r="10" fill="var(--deep)" stroke={ringColor} strokeWidth="2.5" />
            <circle cx={setX} cy={setY} r="3.5" fill={ringColor} />
          </g>
        )}

        {/* celebration ripple burst */}
        <AnimatePresence>
          {celebrate && !reduced && (
            <>
              {[0, 1, 2].map((i) => (
                <motion.circle
                  key={i}
                  cx={half}
                  cy={half}
                  fill="none"
                  stroke="var(--accent)"
                  initial={{ r: ringR - 30, opacity: 0.8, strokeWidth: 3 }}
                  animate={{ r: ringR + 16, opacity: 0, strokeWidth: 0.5 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.1, delay: i * 0.18, ease: "easeOut" }}
                />
              ))}
            </>
          )}
        </AnimatePresence>
      </svg>

      {/* center readout */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] font-medium tracking-[0.2em] text-ink-dim uppercase">{label}</span>
        <div className="temp-display flex items-start leading-none" style={{ fontSize: size * 0.27 }}>
          {temp !== null ? <NumberTicker value={temp} decimals={temp % 1 !== 0 ? 1 : 0} /> : <span>—</span>}
          <span className="mt-2 text-[0.35em] text-ink-dim">°{units}</span>
        </div>
        <div className={cn("mt-1 flex items-center gap-1 text-xs", heating ? "text-heat" : "text-ink-dim")}>
          {heating ? (
            <>
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-heat" />
              {heatSource === "solar" ? "solar heating" : "heating"} to {displaySetPoint}°
            </>
          ) : (
            <>set {displaySetPoint}°</>
          )}
        </div>
      </div>

      {/* nudge buttons */}
      {onSetPoint && (
        <div className="pointer-events-none absolute inset-x-0 bottom-1 flex items-center justify-between px-3">
          <button
            className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full glass text-ink-dim transition hover:text-ink active:scale-90 disabled:opacity-30"
            onClick={() => nudge(-1)}
            disabled={disabled || displaySetPoint <= min}
            aria-label={`Lower ${label} setpoint`}
          >
            <Minus size={16} />
          </button>
          <button
            className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full glass text-ink-dim transition hover:text-ink active:scale-90 disabled:opacity-30"
            onClick={() => nudge(1)}
            disabled={disabled || displaySetPoint >= max}
            aria-label={`Raise ${label} setpoint`}
          >
            <Plus size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
