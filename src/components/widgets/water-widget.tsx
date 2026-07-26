"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudRain, Droplet, Waves } from "lucide-react";
import { useState } from "react";
import { apiGet, apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { usePool } from "@/lib/client/pool-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { roleAtLeast } from "@/types/auth";
import { WidgetFrame } from "./widgets";
import type { WaterEstimate } from "@/server/water";

/**
 * Estimated water level from the evaporation/rain balance — prompts a top-off
 * when the pool is down and no rain is coming (no level sensor required).
 */
export function WaterWidget(): React.JSX.Element {
  const { user } = usePool();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({
    queryKey: ["water"],
    queryFn: () => apiGet<{ water: WaterEstimate }>("/api/water"),
    refetchInterval: 30 * 60_000,
  });
  const water = data?.water;

  const refill = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await apiSend<{ water: WaterEstimate }>("POST", "/api/water");
      queryClient.setQueryData(["water"], res);
      toast("success", "Noted — water level reset", "The balance starts fresh from now.");
    } catch (err) {
      toast("error", "Couldn't record refill", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const down = water ? Math.max(0, -water.netInches) : 0;
  // Visual: 0" down = full bar; 2"+ down = low.
  const levelPct = water ? Math.max(8, 100 - (down / 2) * 100) : 100;

  return (
    <WidgetFrame title="Water level (est.)">
      {water?.available ? (
        <div className="flex h-full flex-col justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* level gauge */}
            <div className="relative h-16 w-9 shrink-0 overflow-hidden rounded-lg border border-line bg-abyss/60">
              <div
                className={cn(
                  "absolute inset-x-0 bottom-0 transition-all duration-700",
                  water.low ? "bg-warn/60" : "bg-accent/50"
                )}
                style={{ height: `${levelPct}%` }}
              />
              <Waves size={13} className="absolute left-1/2 top-1 -translate-x-1/2 text-ink-faint" />
            </div>
            <div className="min-w-0">
              <p className={cn("text-sm font-medium", water.low ? "text-warn" : "text-ink")}>
                {down < 0.25 ? "Looking good" : `Down ~${down.toFixed(1)} in`}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-ink-dim">{water.message}</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
              {water.nextRain ? (
                <>
                  <CloudRain size={12} className="text-accent" /> rain{" "}
                  {new Date(water.nextRain.at).toLocaleDateString("en-US", { weekday: "short" })} ·{" "}
                  {water.nextRain.peakProbability}%
                </>
              ) : (
                <>
                  <Droplet size={12} /> −{water.lossInches}" evap · +{water.rainInches}" rain · {water.sinceDays}d
                </>
              )}
            </span>
            {roleAtLeast(user.role, "family") && (
              <Button size="sm" variant={water.low ? "primary" : "ghost"} onClick={() => void refill()} disabled={busy}>
                I topped it off
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-faint">Needs weather data — check back once online.</p>
      )}
    </WidgetFrame>
  );
}
