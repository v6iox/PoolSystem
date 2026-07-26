"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Droplets,
  Fan,
  FlaskConical,
  Moon,
  ShieldCheck,
  Snowflake,
  Sun,
  Timer,
  Wifi,
  WifiOff,
} from "lucide-react";
import { usePool, patchCircuit } from "@/lib/client/pool-state";
import { apiGet } from "@/lib/client/api";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { NumberTicker } from "@/components/ui/number-ticker";
import { CircuitIcon } from "@/lib/icons";
import { cn, formatMinutes, formatRelative, DAY_LABELS } from "@/lib/utils";
import type { WeatherData } from "@/types/weather";

export function WidgetFrame({
  title,
  href,
  children,
  className,
}: {
  title: string;
  href?: string;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <Panel className={cn("flex h-full flex-col p-4", className)}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">{title}</p>
        {href ? (
          <Link href={href} className="rounded-md p-1 text-ink-faint transition hover:text-accent">
            <ArrowRight size={14} />
          </Link>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </Panel>
  );
}

/* ── Quick toggles ─────────────────────────────────────────────── */

export function QuickTogglesWidget(): React.JSX.Element {
  const { snapshot, sendAction, backendConnected, user } = usePool();
  const items = [...snapshot.circuits, ...snapshot.features]
    .filter((c) => c.showInFeatures && c.type !== "pool" && c.type !== "spa")
    .slice(0, 6);
  const bodies = snapshot.bodies;

  return (
    <WidgetFrame title="Quick controls" href="/circuits">
      <div className="space-y-1.5">
        {bodies.map((b) => (
          <ToggleRow
            key={`body-${b.id}`}
            name={b.name}
            icon={<CircuitIcon type={b.kind} isLight={false} size={17} className="text-accent" />}
            on={b.isOn}
            disabled={!backendConnected}
            onToggle={(on) =>
              void sendAction({ type: "setCircuit", circuitId: b.circuitId, state: on }, patchCircuit(b.circuitId, on))
            }
          />
        ))}
        {items.slice(0, 4).map((c) => (
          <ToggleRow
            key={c.id}
            name={c.name}
            icon={<CircuitIcon type={c.type} isLight={c.isLight} size={17} className={c.isOn ? "text-accent" : "text-ink-faint"} />}
            on={c.isOn}
            disabled={!backendConnected}
            onToggle={(on) => void sendAction({ type: "setCircuit", circuitId: c.id, state: on }, patchCircuit(c.id, on))}
          />
        ))}
        {items.length === 0 && bodies.length === 0 && (
          <p className="text-sm text-ink-faint">{user.role === "guest" ? "Nothing shared with guests yet." : "No circuits reported."}</p>
        )}
      </div>
    </WidgetFrame>
  );
}

function ToggleRow({
  name,
  icon,
  on,
  disabled,
  onToggle,
}: {
  name: string;
  icon: React.ReactNode;
  on: boolean;
  disabled: boolean;
  onToggle: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-accent-soft/40">
      <span className="flex min-w-0 items-center gap-2.5 text-sm text-ink">
        {icon}
        <span className="truncate">{name}</span>
      </span>
      <Switch checked={on} onCheckedChange={onToggle} disabled={disabled} aria-label={name} />
    </div>
  );
}

/* ── Pump ──────────────────────────────────────────────────────── */

export function PumpWidget(): React.JSX.Element {
  const { snapshot } = usePool();
  const pump = snapshot.pumps[0];
  return (
    <WidgetFrame title="Pump" href="/pump">
      {pump ? (
        <div className="flex h-full flex-col justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className={cn("rounded-full p-2", pump.isRunning ? "bg-accent-soft text-accent pulse-active" : "bg-abyss/50 text-ink-faint")}>
              <Fan size={18} className={pump.isRunning ? "animate-[spin_3s_linear_infinite]" : undefined} />
            </span>
            <div>
              <p className="text-sm font-medium text-ink">{pump.name}</p>
              <p className="text-xs text-ink-dim">{pump.isRunning ? "Running" : "Off"}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="RPM" value={<NumberTicker value={pump.rpm} />} />
            <Stat label="Watts" value={<NumberTicker value={pump.watts} />} />
            <Stat label="GPM" value={pump.flow !== null ? <NumberTicker value={pump.flow} /> : "—"} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-faint">No pump reported.</p>
      )}
    </WidgetFrame>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-line bg-abyss/30 px-2 py-2">
      <p className="temp-display text-lg text-ink">{value}</p>
      <p className="text-[10px] tracking-wider text-ink-faint uppercase">{label}</p>
    </div>
  );
}

/* ── Chlorinator / salt ────────────────────────────────────────── */

export function ChlorinatorWidget(): React.JSX.Element {
  const { snapshot } = usePool();
  const chlor = snapshot.chlorinators[0];
  return (
    <WidgetFrame title="Chlorinator" href="/chlorinator">
      {chlor ? (
        <div className="flex h-full flex-col justify-between gap-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-ink">
              <Droplets size={16} className={chlor.isActive ? "text-accent" : "text-ink-faint"} />
              {chlor.superChlor ? "Super-chlorinating" : chlor.isActive ? `Output ${chlor.currentOutput}%` : "Standby"}
            </span>
          </div>
          <div>
            <div className="mb-1 flex items-end justify-between">
              <span className="temp-display text-3xl text-ink">
                <NumberTicker value={chlor.saltLevel} />
                <span className="ml-1 text-xs text-ink-dim">ppm</span>
              </span>
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                  chlor.saltRequired ? "bg-danger/15 text-danger" : "bg-ok/15 text-ok"
                )}
              >
                {chlor.saltRequired ? "Salt low" : "Salt OK"}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-abyss/60">
              <div
                className={cn("h-full rounded-full", chlor.saltRequired ? "bg-danger" : "bg-accent")}
                style={{ width: `${Math.min(100, (chlor.saltLevel / 4500) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-faint">No chlorinator reported.</p>
      )}
    </WidgetFrame>
  );
}

/* ── Weather ───────────────────────────────────────────────────── */

function weatherIcon(code: number, isDay: boolean): React.ReactNode {
  if (code === 0) return isDay ? <Sun size={30} className="text-warn" /> : <Moon size={30} className="text-accent" />;
  if (code <= 3) return <Cloud size={30} className="text-ink-dim" />;
  if (code <= 48) return <CloudFog size={30} className="text-ink-dim" />;
  if (code <= 57) return <CloudDrizzle size={30} className="text-accent" />;
  if (code <= 67) return <CloudRain size={30} className="text-accent" />;
  if (code <= 77) return <CloudSnow size={30} className="text-accent" />;
  if (code <= 82) return <CloudRain size={30} className="text-accent" />;
  return <CloudLightning size={30} className="text-warn" />;
}

const WEATHER_DESC: Array<[number, string]> = [
  [0, "Clear"], [3, "Partly cloudy"], [48, "Foggy"], [57, "Drizzle"], [67, "Rain"], [77, "Snow"], [82, "Showers"], [99, "Thunderstorm"],
];

export function WeatherWidget(): React.JSX.Element {
  const { snapshot } = usePool();
  const { data } = useQuery({
    queryKey: ["weather"],
    queryFn: () => apiGet<{ weather: WeatherData | null }>("/api/weather"),
    refetchInterval: 10 * 60_000,
  });
  const w = data?.weather;
  const desc = w ? (WEATHER_DESC.find(([max]) => w.code <= max)?.[1] ?? "—") : "";
  const useC = snapshot.units === "C";
  const fromTempest = w?.source === "tempest";
  return (
    <WidgetFrame title={fromTempest ? "Weather · Tempest" : "Weather"}>
      {w ? (
        <div className="flex h-full flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="temp-display text-3xl text-ink">
                {Math.round(useC ? w.tempC : w.tempF)}°
              </p>
              <p className="text-xs text-ink-dim">
                {desc}
                {fromTempest && w.humidity !== undefined ? ` · ${Math.round(w.humidity)}% rh` : ""}
              </p>
            </div>
            {weatherIcon(w.code, w.isDay)}
          </div>
          <p className="text-[11px] text-ink-faint">
            H {Math.round(useC ? ((w.high - 32) * 5) / 9 : w.high)}° · L {Math.round(useC ? ((w.low - 32) * 5) / 9 : w.low)}° · wind{" "}
            {Math.round(w.windMph)}
            {fromTempest && w.gustMph !== undefined ? `–${Math.round(w.gustMph)}` : ""} mph
            {fromTempest && w.uv !== undefined ? ` · UV ${Math.round(w.uv)}` : ""}
            {fromTempest && w.rainTodayIn !== undefined && w.rainTodayIn > 0 ? ` · ${w.rainTodayIn}" rain today` : ""}
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink-faint">Weather unavailable (offline?)</p>
      )}
    </WidgetFrame>
  );
}

/* ── Upcoming schedules ────────────────────────────────────────── */

export function SchedulesWidget(): React.JSX.Element {
  const { snapshot } = usePool();
  const nowDay = new Date().getDay();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const upcoming = snapshot.schedules
    .filter((s) => !s.disabled)
    .map((s) => {
      // minutes until next start
      let best = Infinity;
      for (let offset = 0; offset < 7; offset++) {
        const day = (nowDay + offset) % 7;
        if (!s.days.includes(day)) continue;
        const delta = offset * 1440 + s.startTime - nowMin;
        if (delta >= 0 && delta < best) best = delta;
      }
      return { s, inMin: best };
    })
    .filter((x) => x.inMin !== Infinity)
    .sort((a, b) => a.inMin - b.inMin)
    .slice(0, 4);

  return (
    <WidgetFrame title="Coming up" href="/schedules">
      {upcoming.length > 0 ? (
        <ul className="space-y-2">
          {upcoming.map(({ s, inMin }) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-ink">
                <CalendarClock size={14} className={s.isActive ? "text-accent" : "text-ink-faint"} />
                <span className="truncate">{s.circuitName}</span>
                {s.isActive && <span className="rounded bg-accent-soft px-1 text-[10px] font-medium text-accent">ON</span>}
              </span>
              <span className="shrink-0 text-xs text-ink-dim">
                {inMin < 1440 ? formatMinutes(s.startTime) : `${DAY_LABELS[(nowDay + Math.floor(inMin / 1440)) % 7]} ${formatMinutes(s.startTime)}`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-faint">No schedules coming up.</p>
      )}
    </WidgetFrame>
  );
}

/* ── Chemistry snapshot ────────────────────────────────────────── */

interface ChemReadingRow {
  at: number;
  ph: number | null;
  fc: number | null;
  ta: number | null;
  salt: number | null;
}

export function ChemistryWidget(): React.JSX.Element {
  const { snapshot } = usePool();
  const { data } = useQuery({
    queryKey: ["chem-latest"],
    queryFn: () => apiGet<{ readings: ChemReadingRow[] }>("/api/chemistry?limit=1"),
    refetchInterval: 5 * 60_000,
  });
  const chem = snapshot.chem[0];
  const last = data?.readings[0];
  return (
    <WidgetFrame title="Chemistry" href="/chemistry">
      {chem ? (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="pH" value={chem.ph?.toFixed(2) ?? "—"} />
          <Stat label="ORP mV" value={chem.orp !== null ? Math.round(chem.orp) : "—"} />
        </div>
      ) : last ? (
        <div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="pH" value={last.ph?.toFixed(1) ?? "—"} />
            <Stat label="FC" value={last.fc ?? "—"} />
            <Stat label="TA" value={last.ta ?? "—"} />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-faint">
            <FlaskConical size={12} /> tested {formatRelative(last.at)}
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink-faint">No tests logged yet.</p>
      )}
    </WidgetFrame>
  );
}

/* ── System health ─────────────────────────────────────────────── */

export function HealthWidget(): React.JSX.Element {
  const { snapshot, backendConnected } = usePool();
  const rows: Array<{ icon: React.ReactNode; label: string; value: string; tone: "ok" | "warn" | "bad" }> = [
    {
      icon: backendConnected ? <Wifi size={14} /> : <WifiOff size={14} />,
      label: "Controller",
      value: backendConnected ? (snapshot.mock ? "Simulated" : "Connected") : "Offline",
      tone: backendConnected ? "ok" : "bad",
    },
    {
      icon: <Snowflake size={14} />,
      label: "Freeze protect",
      value: snapshot.freezeProtect ? "ACTIVE" : "Idle",
      tone: snapshot.freezeProtect ? "warn" : "ok",
    },
    {
      icon: <Timer size={14} />,
      label: "Delays",
      value: snapshot.delay ? "In delay" : "None",
      tone: snapshot.delay ? "warn" : "ok",
    },
    {
      icon: snapshot.panelMode === "auto" ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />,
      label: "Panel",
      value: snapshot.panelMode,
      tone: snapshot.panelMode === "auto" ? "ok" : "warn",
    },
  ];
  return (
    <WidgetFrame title="System" href="/settings/system">
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-ink-dim">
              {r.icon}
              {r.label}
            </span>
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize",
                r.tone === "ok" && "bg-ok/10 text-ok",
                r.tone === "warn" && "bg-warn/10 text-warn",
                r.tone === "bad" && "bg-danger/10 text-danger"
              )}
            >
              {r.value}
            </span>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  );
}
