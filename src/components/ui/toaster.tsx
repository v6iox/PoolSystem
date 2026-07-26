"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useToastStore } from "@/stores/toast";
import { cn } from "@/lib/utils";

const ICONS = {
  success: <CheckCircle2 size={18} className="text-ok" />,
  error: <AlertTriangle size={18} className="text-danger" />,
  info: <Info size={18} className="text-accent" />,
} as const;

export function Toaster(): React.JSX.Element {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 500, damping: 32 }}
            className={cn(
              "glass-bright pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl px-4 py-3",
              t.kind === "error" && "border-danger/30"
            )}
          >
            <span className="mt-0.5 shrink-0">{ICONS[t.kind]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{t.title}</p>
              {t.detail ? <p className="mt-0.5 text-xs text-ink-dim break-words">{t.detail}</p> : null}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-md p-1 text-ink-faint hover:text-ink"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
