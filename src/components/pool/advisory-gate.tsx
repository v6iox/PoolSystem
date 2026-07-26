"use client";

import { useCallback, useState } from "react";
import { CloudRain, Info } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/client/api";
import type { Advisory } from "@/types/weather";

/**
 * Weather-aware confirmation gate. Call `gate(opts, proceed)` before a heat
 * action: if the forecast has something worth knowing ("Rain is forecast
 * tomorrow 3–4 PM"), an are-you-sure dialog appears; otherwise the action
 * runs immediately — no nagging on clear days.
 */

interface GateOptions {
  bodyId: number;
  bodyName: string;
  setPoint?: number;
  /** What the confirm button should say, e.g. "Heat anyway" */
  confirmLabel?: string;
  /** One-line description of the action, e.g. "Turn on the pool heater" */
  intent: string;
}

interface PendingGate {
  options: GateOptions;
  advisories: Advisory[];
  proceed: () => void;
}

export function useAdvisoryGate(): {
  gate: (options: GateOptions, proceed: () => void) => Promise<void>;
  dialog: React.JSX.Element;
} {
  const [pending, setPending] = useState<PendingGate | null>(null);

  const gate = useCallback(async (options: GateOptions, proceed: () => void): Promise<void> => {
    try {
      const params = new URLSearchParams({ context: "heat", bodyId: String(options.bodyId) });
      if (options.setPoint !== undefined) params.set("setPoint", String(options.setPoint));
      const res = await apiGet<{ advisories: Advisory[] }>(`/api/advisories?${params.toString()}`);
      if (res.advisories.length > 0) {
        setPending({ options, advisories: res.advisories, proceed });
        return;
      }
    } catch {
      // advisory service unavailable — never block the actual control
    }
    proceed();
  }, []);

  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      {pending && (
        <DialogContent
          title={`Heads up before heating ${pending.options.bodyName.toLowerCase()}`}
          description={pending.options.intent}
        >
          <ul className="space-y-2.5">
            {pending.advisories.map((a, i) => (
              <li
                key={i}
                className={
                  a.severity === "caution"
                    ? "flex items-start gap-2.5 rounded-xl border border-warn/25 bg-warn/10 px-3 py-2.5 text-sm text-warn"
                    : "flex items-start gap-2.5 rounded-xl border border-line bg-accent-soft px-3 py-2.5 text-sm text-ink"
                }
              >
                {a.severity === "caution" ? (
                  <CloudRain size={16} className="mt-0.5 shrink-0" />
                ) : (
                  <Info size={16} className="mt-0.5 shrink-0 text-accent" />
                )}
                {a.message}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex gap-2">
            <Button variant="glass" className="flex-1" onClick={() => setPending(null)}>
              Never mind
            </Button>
            <Button
              variant="heat"
              className="flex-1"
              onClick={() => {
                pending.proceed();
                setPending(null);
              }}
            >
              {pending.options.confirmLabel ?? "Do it anyway"}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );

  return { gate, dialog };
}
