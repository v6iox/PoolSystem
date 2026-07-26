"use client";

import { useState } from "react";
import { Flame, Zap } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/input";
import { roleAtLeast } from "@/types/auth";
import type { ChlorinatorState } from "@/types/pool";
import { patchChlorinator } from "./optimistic";

const PRESET_HOURS = [8, 12, 24, 48, 72];

/** Super-chlorinate control: duration picker + start/stop. */
export function SuperChlorCard({ chlor }: { chlor: ChlorinatorState }): React.JSX.Element {
  const { sendAction, backendConnected, user } = usePool();
  const canControl = backendConnected && roleAtLeast(user.role, "family");
  const [hours, setHours] = useState<string>(() =>
    String(PRESET_HOURS.includes(chlor.superChlorHours) ? chlor.superChlorHours : 24)
  );

  const options = PRESET_HOURS.map((h) => ({ value: String(h), label: `${h} hours` }));

  const start = (): void => {
    const h = Number(hours);
    void sendAction(
      { type: "superChlorinate", chlorId: chlor.id, hours: h, on: true },
      patchChlorinator(chlor.id, { superChlor: true, superChlorHours: h, currentOutput: 100 })
    );
  };

  const stop = (): void => {
    void sendAction(
      { type: "superChlorinate", chlorId: chlor.id, hours: Number(hours), on: false },
      patchChlorinator(chlor.id, { superChlor: false })
    );
  };

  return (
    <Panel className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <Flame size={15} className={chlor.superChlor ? "text-heat" : "text-ink-faint"} />
        <p className="text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">Super-chlorinate</p>
      </div>
      <p className="text-sm text-ink-dim">
        Run the cell at 100% output to shock the water after heavy use, rain, or algae trouble.
      </p>
      <div className="mt-auto flex items-end gap-3">
        <div className="flex-1">
          <Field label="Duration">
            <Select
              value={hours}
              onValueChange={setHours}
              options={options}
              disabled={!canControl || chlor.superChlor}
              aria-label="Super-chlorinate duration"
            />
          </Field>
        </div>
        {chlor.superChlor ? (
          <Button variant="heat" onClick={stop} disabled={!canControl} className="shrink-0">
            <Flame size={16} /> Stop · {chlor.superChlorHours}h left
          </Button>
        ) : (
          <Button variant="primary" onClick={start} disabled={!canControl} className="shrink-0">
            <Zap size={16} /> Start boost
          </Button>
        )}
      </div>
    </Panel>
  );
}
