"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign, Timer, Zap } from "lucide-react";
import { apiGet } from "@/lib/client/api";
import { usePool } from "@/lib/client/pool-state";
import { roleAtLeast } from "@/types/auth";

interface RuntimeRow {
  day: string;
  key: string;
  hours: number;
  kwh: number;
  cost: number;
}

interface RuntimeResponse {
  costPerKwh: number;
  rows: RuntimeRow[];
}

function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today's runtime, energy and estimated cost for one pump. */
export function PumpRuntime({ pumpId }: { pumpId: number }): React.JSX.Element {
  const { user } = usePool();
  const allowed = roleAtLeast(user.role, "family");
  const { data, isPending } = useQuery({
    queryKey: ["runtime", 1],
    queryFn: () => apiGet<RuntimeResponse>("/api/history/runtime?days=1"),
    refetchInterval: 60_000,
    enabled: allowed,
  });

  const today = localDay();
  const rows = (data?.rows ?? []).filter((r) => r.key === `pump:${pumpId}` && r.day === today);
  const hours = rows.reduce((sum, r) => sum + r.hours, 0);
  const kwh = rows.reduce((sum, r) => sum + r.kwh, 0);
  const cost = rows.reduce((sum, r) => sum + r.cost, 0);
  const loading = allowed && isPending;

  const cells: Array<{ icon: React.ReactNode; label: string; value: string }> = [
    { icon: <Timer size={13} />, label: "Runtime today", value: loading ? "—" : `${hours.toFixed(1)} h` },
    { icon: <Zap size={13} />, label: "Energy", value: loading ? "—" : `${kwh.toFixed(2)} kWh` },
    { icon: <CircleDollarSign size={13} />, label: "Est. cost", value: loading ? "—" : `$${cost.toFixed(2)}` },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 border-t border-line pt-3.5">
      {cells.map((c) => (
        <div key={c.label} className="min-w-0">
          <p className="flex items-center gap-1 text-[10px] tracking-wider text-ink-faint uppercase">
            {c.icon}
            <span className="truncate">{c.label}</span>
          </p>
          <p className="temp-display mt-0.5 text-base text-ink">{c.value}</p>
        </div>
      ))}
    </div>
  );
}
