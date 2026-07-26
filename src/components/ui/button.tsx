"use client";

import { forwardRef, useCallback, useRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl font-medium transition-all duration-200 select-none disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.97]",
  {
    variants: {
      variant: {
        primary: "bg-accent text-abyss shadow-[0_2px_16px_-2px] shadow-accent/40 hover:brightness-110",
        glass: "glass text-ink hover:border-line-bright",
        ghost: "text-ink-dim hover:bg-accent-soft hover:text-ink",
        danger: "bg-danger/15 text-danger border border-danger/25 hover:bg-danger/25",
        heat: "bg-heat text-abyss shadow-[0_2px_16px_-2px] shadow-heat/40 hover:brightness-110",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-11 px-4 text-sm",
        lg: "h-13 px-6 text-base",
        icon: "h-11 w-11",
        iconSm: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "glass", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

/** Button with a water-ripple press effect (honors reduced motion via CSS). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, onPointerDown, children, ...props },
  ref
) {
  const innerRef = useRef<HTMLButtonElement | null>(null);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>): void => {
      onPointerDown?.(event);
      const el = innerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ripple = document.createElement("span");
      ripple.className = "ripple-ink";
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
      el.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 600);
    },
    [onPointerDown]
  );

  return (
    <button
      ref={(node) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      className={cn(buttonVariants({ variant, size }), className)}
      onPointerDown={handlePointerDown}
      {...props}
    >
      {children}
    </button>
  );
});
