"use client";

import { Check, ChevronRight, Info, Loader2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CopilotMessage } from "./types";

/**
 * The confirmation card attached to a state-changing assistant message.
 * pending → summary rows + Confirm/Cancel; executed → checkmarked result
 * rows; error → warning rows; cancelled → dimmed.
 */
export function PlanCard({
  message,
  disabled,
  busy,
  onConfirm,
  onCancel,
}: {
  message: CopilotMessage;
  /** Controller offline → executing anything is pointless. */
  disabled: boolean;
  /** A confirm/cancel request for this message is in flight. */
  busy: boolean;
  onConfirm: (messageId: number) => void;
  onCancel: (messageId: number) => void;
}): React.JSX.Element | null {
  const plan = message.plan;
  const state = message.planState;
  if (!plan || !state) return null;

  const finished = state === "executed" || state === "error";
  const rows = finished && plan.results && plan.results.length > 0 ? plan.results : plan.summary;

  const rowIcon = (row: string): React.ReactNode => {
    if (state === "pending" || state === "confirmed") return <ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" />;
    if (state === "cancelled") return <X size={14} className="mt-0.5 shrink-0 text-ink-faint" />;
    if (row.startsWith("Failed")) return <TriangleAlert size={14} className="mt-0.5 shrink-0 text-danger" />;
    return <Check size={14} className="mt-0.5 shrink-0 text-ok" />;
  };

  return (
    <div
      className={cn(
        "mt-2.5 rounded-xl border p-3",
        state === "pending" && "border-accent/30 bg-accent-soft/30",
        state === "confirmed" && "border-accent/30 bg-accent-soft/20",
        state === "executed" && "border-ok/25 bg-ok/5",
        state === "error" && "border-danger/25 bg-danger/5",
        state === "cancelled" && "border-line opacity-55"
      )}
    >
      <ul className="space-y-1.5">
        {rows.map((row, i) => (
          <li key={i} className={cn("flex items-start gap-2 text-sm text-ink", state === "cancelled" && "text-ink-dim")}>
            {rowIcon(row)}
            <span className="min-w-0">{row}</span>
          </li>
        ))}
      </ul>

      {plan.note && state === "pending" && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
          <Info size={13} className="mt-0.5 shrink-0" />
          {plan.note}
        </p>
      )}

      {state === "pending" && (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" size="sm" disabled={disabled || busy} onClick={() => onConfirm(message.id)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Confirm
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onCancel(message.id)}>
            <X size={14} /> Cancel
          </Button>
          {disabled && <span className="text-xs text-ink-faint">controller offline</span>}
        </div>
      )}
      {state === "confirmed" && (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-accent">
          <Loader2 size={13} className="animate-spin" /> Running…
        </p>
      )}
      {state === "cancelled" && (
        <p className="mt-2 text-[11px] font-semibold tracking-wider text-ink-faint uppercase">Cancelled</p>
      )}
      {state === "executed" && <p className="mt-2 text-[11px] font-semibold tracking-wider text-ok uppercase">Done</p>}
      {state === "error" && <p className="mt-2 text-[11px] font-semibold tracking-wider text-danger uppercase">Failed</p>}
    </div>
  );
}
