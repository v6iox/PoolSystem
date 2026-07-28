"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Wrench } from "lucide-react";
import type { AdvancedOptions } from "@/server/adapters/types";
import { apiGet, apiSend } from "@/lib/client/api";
import { usePool } from "@/lib/client/pool-state";
import { toast } from "@/stores/toast";
import { Panel } from "@/components/ui/panel";

/**
 * Shared plumbing for the per-page "Advanced" panel-configuration menus.
 * Owner-only: these write to the Pentair panel itself through njsPC.
 */

export interface AdvancedResponse {
  advanced: AdvancedOptions;
}

export function useAdvanced(): {
  advanced: AdvancedOptions | undefined;
  isOwner: boolean;
  disabled: boolean;
  pending: boolean;
  send: (action: string, payload: Record<string, unknown>, okMessage: string) => Promise<boolean>;
} {
  const { user, backendConnected } = usePool();
  const queryClient = useQueryClient();
  const isOwner = user.role === "owner";
  const query = useQuery({
    queryKey: ["advanced"],
    queryFn: () => apiGet<AdvancedResponse>("/api/advanced"),
    enabled: isOwner,
    staleTime: 30_000,
  });

  const send = async (action: string, payload: Record<string, unknown>, okMessage: string): Promise<boolean> => {
    try {
      const res = await apiSend<AdvancedResponse & { ok: boolean }>("PUT", `/api/advanced/${action}`, payload);
      queryClient.setQueryData(["advanced"], { advanced: res.advanced });
      toast("success", okMessage, "Written to the panel.");
      return true;
    } catch (err) {
      toast("error", "Panel rejected the change", err instanceof Error ? err.message : undefined);
      return false;
    }
  };

  return { advanced: query.data?.advanced, isOwner, disabled: !backendConnected, pending: query.isPending, send };
}

/** Collapsible "Advanced" wrapper — closed by default, out of the way. */
export function AdvancedDisclosure({
  title = "Advanced — panel configuration",
  hint = "Written to the Pentair panel itself. Changes affect every controller (ScreenLogic included).",
  children,
}: {
  title?: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl px-1 py-1.5 text-left"
      >
        <Wrench size={13} className="text-accent" />
        <span className="text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">{title}</span>
        <ChevronDown
          size={14}
          className={`ml-auto text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 34 }}
            className="overflow-hidden"
          >
            <p className="mb-2 px-1 text-xs text-ink-faint">{hint}</p>
            <Panel className="divide-y divide-line overflow-hidden">{children}</Panel>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** Text input that saves on blur/Enter when the value actually changed. */
export function SaveOnBlurInput({
  value,
  onSave,
  disabled,
  maxLength = 24,
  ariaLabel,
  className,
}: {
  value: string;
  onSave: (next: string) => void;
  disabled?: boolean;
  maxLength?: number;
  ariaLabel: string;
  className?: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft !== null && draft.trim() && draft.trim() !== value) onSave(draft.trim());
    setDraft(null);
  };
  return (
    <input
      type="text"
      value={draft ?? value}
      maxLength={maxLength}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(null);
      }}
      className={`rounded-lg border border-line bg-abyss/40 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent/50 disabled:opacity-40 ${className ?? ""}`}
    />
  );
}

/** Number input with a compact save button, for RPM / minutes fields. */
export function NumberField({
  value,
  min,
  max,
  suffix,
  disabled,
  onSave,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  suffix: string;
  disabled?: boolean;
  onSave: (next: number) => void;
  ariaLabel: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const current = draft ?? String(value);
  const parsed = Number(current);
  const dirty = draft !== null && parsed !== value;
  const valid = Number.isFinite(parsed) && parsed >= min && parsed <= max;
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="number"
        value={current}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty && valid) {
            onSave(parsed);
            setDraft(null);
          }
        }}
        className="w-20 rounded-lg border border-line bg-abyss/40 px-2 py-1.5 text-right text-sm tabular-nums text-ink outline-none focus:border-accent/50 disabled:opacity-40"
      />
      <span className="text-xs text-ink-faint">{suffix}</span>
      {dirty && (
        <button
          type="button"
          disabled={!valid || disabled}
          onClick={() => {
            onSave(parsed);
            setDraft(null);
          }}
          className="rounded-lg bg-accent-soft px-2 py-1 text-xs font-medium text-accent disabled:opacity-40"
        >
          Save
        </button>
      )}
    </span>
  );
}
