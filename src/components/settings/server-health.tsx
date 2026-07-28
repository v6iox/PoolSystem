"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Cpu, Database, HardDrive, MemoryStick, Thermometer, Timer } from "lucide-react";
import type { SystemStats } from "@/server/sysinfo";
import { apiGet } from "@/lib/client/api";
import { usePool } from "@/lib/client/pool-state";
import { roleAtLeast } from "@/types/auth";
import { SettingRow, SettingsSection } from "@/components/settings/section";
import { Skeleton } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

/** Live server health — polls every 5s while the page is open. */

function UsageBar({ pct, hot }: { pct: number; hot: boolean }): React.JSX.Element {
  return (
    <span className="flex w-36 items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-abyss/60">
        <span
          className={cn("block h-full rounded-full transition-all duration-700", hot ? "bg-warn" : "bg-accent")}
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        />
      </span>
      <span className={cn("w-10 text-right text-sm tabular-nums", hot ? "text-warn" : "text-ink")}>{Math.round(pct)}%</span>
    </span>
  );
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ServerHealth(): React.JSX.Element | null {
  const { user } = usePool();
  const isFamily = roleAtLeast(user.role, "family");
  const query = useQuery({
    queryKey: ["system-stats"],
    queryFn: () => apiGet<{ stats: SystemStats }>("/api/system/stats"),
    enabled: isFamily,
    refetchInterval: 5_000,
  });
  if (!isFamily) return null;
  const s = query.data?.stats;

  return (
    <SettingsSection
      icon={<Activity size={14} />}
      title="Server health"
      description="Live readings from the machine running Moonpool — refreshes every 5 seconds."
    >
      {!s ? (
        <div className="p-4">
          <Skeleton className="h-24" />
        </div>
      ) : (
        <>
          <SettingRow icon={<Cpu size={16} />} label="CPU" hint={`${s.cores} cores · load ${s.loadAvg1}`}>
            <UsageBar pct={s.cpuPct} hot={s.cpuPct >= 85} />
          </SettingRow>
          <SettingRow
            icon={<MemoryStick size={16} />}
            label="Memory"
            hint={`${(s.memUsedMb / 1024).toFixed(1)} of ${(s.memTotalMb / 1024).toFixed(1)} GB used`}
          >
            <UsageBar pct={(s.memUsedMb / Math.max(1, s.memTotalMb)) * 100} hot={s.memUsedMb / Math.max(1, s.memTotalMb) >= 0.9} />
          </SettingRow>
          <SettingRow icon={<Database size={16} />} label="Moonpool process" hint={`Node ${s.nodeVersion} · ${s.platform}`}>
            <span className="text-sm tabular-nums text-ink">{s.processRssMb} MB</span>
          </SettingRow>
          {s.cpuTempC !== null && (
            <SettingRow icon={<Thermometer size={16} />} label="CPU temperature" hint="SoC thermal sensor">
              <span className={cn("text-sm tabular-nums", s.cpuTempC >= 75 ? "text-warn" : "text-ink")}>{s.cpuTempC}°C</span>
            </SettingRow>
          )}
          {s.diskFreeGb !== null && s.diskTotalGb !== null && (
            <SettingRow icon={<HardDrive size={16} />} label="Disk" hint="Where the Moonpool database lives">
              <span className="text-sm tabular-nums text-ink">
                {s.diskFreeGb} GB free <span className="text-ink-faint">/ {s.diskTotalGb} GB</span>
              </span>
            </SettingRow>
          )}
          <SettingRow
            icon={<Timer size={16} />}
            label="Uptime"
            hint={`Moonpool ${formatUptime(s.processUptimeSec)} · system ${formatUptime(s.osUptimeSec)}`}
          />
        </>
      )}
    </SettingsSection>
  );
}
