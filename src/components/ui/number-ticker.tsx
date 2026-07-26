"use client";

import { useEffect, useRef } from "react";
import { animate, useMotionValue, useTransform, motion, useReducedMotion } from "motion/react";

/** Animated numeric readout — big temperature numerals tick smoothly between values. */
export function NumberTicker({
  value,
  decimals = 0,
  className,
}: {
  value: number;
  decimals?: number;
  className?: string;
}): React.JSX.Element {
  const reduced = useReducedMotion();
  const mv = useMotionValue(value);
  const rounded = useTransform(mv, (v) => v.toFixed(decimals));
  const first = useRef(true);

  useEffect(() => {
    if (first.current || reduced) {
      first.current = false;
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.7, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [value, mv, reduced]);

  return <motion.span className={className}>{rounded}</motion.span>;
}
