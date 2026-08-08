"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CloudSun, ExternalLink, Loader2, RadioTower, Search } from "lucide-react";
import { apiGet, apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SettingRow, SettingsSection } from "@/components/settings/section";
import { Skeleton } from "@/components/ui/panel";
import { formatRelative } from "@/lib/utils";

/**
 * WeatherFlow Tempest setup — everything the .env vars do, from the UI:
 * UDP toggle, REST token + station picker, live status. The hyper-local data
 * feeds heat advisories, the water-level estimator and lightning alerts.
 */

interface TempestInfo {
  settings: { udp: boolean; tokenSet: boolean; tokenTail: string; stationId: string; storedKeys: string[] };
  status: {
    mock: boolean;
    udpEnabled: boolean;
    udpListening: boolean;
    udpPacketsSeen: number;
    restConfigured: boolean;
    lastRestOkAt: number | null;
    lastRestError: string | null;
    receiving: boolean;
    source: "udp" | "rest" | null;
    lastObsAt: number | null;
    current: { tempF: number; windMph: number; rainTodayMm: number } | null;
  };
}

export function TempestSection(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [stations, setStations] = useState<Array<{ id: number; name: string }> | null>(null);

  const query = useQuery({
    queryKey: ["tempest"],
    queryFn: () => apiGet<TempestInfo>("/api/settings/tempest"),
    refetchInterval: 30_000,
  });
  const info = query.data;

  const save = async (patch: Record<string, unknown>, okMsg: string): Promise<void> => {
    setBusy(true);
    try {
      const res = await apiSend<TempestInfo>("PUT", "/api/settings/tempest", patch);
      queryClient.setQueryData(["tempest"], res);
      toast("success", okMsg);
    } catch (err) {
      toast("error", "Couldn't save", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const findStations = async (): Promise<void> => {
    setBusy(true);
    setStations(null);
    try {
      const res = await apiSend<{ stations: Array<{ id: number; name: string }> }>(
        "POST",
        "/api/settings/tempest/stations",
        token.trim() ? { token: token.trim() } : {}
      );
      if (res.stations.length === 0) {
        toast("info", "No stations on that account", "The token works, but WeatherFlow lists no stations for it.");
      }
      setStations(res.stations);
      // Auto-pick when there's exactly one — the common case.
      if (res.stations.length === 1 && res.stations[0]) {
        const patch: Record<string, unknown> = { stationId: String(res.stations[0].id) };
        if (token.trim()) patch.token = token.trim();
        await save(patch, `Station "${res.stations[0].name}" connected`);
        setToken("");
      }
    } catch (err) {
      toast("error", "Couldn't list stations", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const s = info?.status;
  const receiving = s?.receiving === true;

  return (
    <SettingsSection
      icon={<CloudSun size={14} />}
      title="Tempest weather station"
      description="Hyper-local weather from your WeatherFlow Tempest — feeds heat advisories, rain measurements for the water-level estimator, and lightning alerts."
    >
      {query.isPending || !info ? (
        <div className="p-4">
          <Skeleton className="h-16" />
        </div>
      ) : (
        <>
          {/* Live status */}
          <div className="mx-4 mt-3 rounded-xl border border-line bg-abyss/40 p-3">
            {s?.mock ? (
              <p className="flex items-center gap-2 text-xs text-ink-dim">
                <RadioTower size={13} className="text-accent" /> Simulator — synthetic Tempest data is shown so every
                Tempest feature is demoable.
              </p>
            ) : receiving ? (
              <p className="flex items-center gap-2 text-xs text-ink-dim">
                <CheckCircle2 size={13} className="shrink-0 text-ok" />
                <span>
                  <span className="font-medium text-ink">Receiving live data</span> via{" "}
                  {s?.source === "udp" ? "LAN broadcast" : "WeatherFlow cloud"}
                  {s?.lastObsAt ? ` · updated ${formatRelative(s.lastObsAt)}` : ""}
                  {s?.current ? ` · ${Math.round(s.current.tempF)}°F, wind ${Math.round(s.current.windMph)} mph` : ""}
                </span>
              </p>
            ) : (
              <div className="space-y-1">
                <p className="flex items-center gap-2 text-xs font-medium text-warn">
                  <RadioTower size={13} className="shrink-0" /> Not receiving station data
                </p>
                <p className="text-xs text-ink-faint">
                  {s?.lastRestError
                    ? s.lastRestError
                    : s?.udpListening && s.udpPacketsSeen === 0
                      ? "Listening on UDP :50222 but no broadcasts arrive — Docker bridge networks often can't see them. Paste a token below; the cloud fallback is just as good."
                      : "Add your WeatherFlow token below to connect through the cloud."}
                </p>
              </div>
            )}
          </div>

          <SettingRow label="Listen for LAN broadcasts" hint="The hub broadcasts on UDP :50222 — free, local, no account">
            <Switch
              checked={info.settings.udp}
              disabled={busy}
              onCheckedChange={(udp) => void save({ udp }, udp ? "Listening on :50222" : "LAN listening off")}
              aria-label="Tempest UDP"
            />
          </SettingRow>

          <SettingRow
            label="WeatherFlow token"
            hint={
              info.settings.tokenSet ? (
                `Token saved (…${info.settings.tokenTail}) — used when broadcasts can't reach Moonpool`
              ) : (
                <>
                  Create one at tempestwx.com → Settings → Data Authorizations{" "}
                  <a
                    href="https://tempestwx.com/settings/tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-accent"
                  >
                    open <ExternalLink size={10} />
                  </a>
                </>
              )
            }
          >
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={info.settings.tokenSet ? "••••••••" : "paste token"}
                className="w-40"
                aria-label="WeatherFlow token"
              />
              <Button size="sm" variant="glass" disabled={busy || (!token.trim() && !info.settings.tokenSet)} onClick={() => void findStations()}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Find my station
              </Button>
            </div>
          </SettingRow>

          {stations && stations.length > 1 && (
            <SettingRow label="Station" hint="This account has several stations — pick the one at the pool">
              <Select
                value={info.settings.stationId}
                onValueChange={(id) => {
                  const patch: Record<string, unknown> = { stationId: id };
                  if (token.trim()) patch.token = token.trim();
                  void save(patch, "Station connected").then(() => setToken(""));
                }}
                options={stations.map((st) => ({ value: String(st.id), label: `${st.name} (#${st.id})` }))}
                aria-label="Tempest station"
                className="w-52"
              />
            </SettingRow>
          )}

          {info.settings.stationId && (
            <SettingRow label="Connected station" hint={`Station #${info.settings.stationId} · polls every 5 min when broadcasts are quiet`}>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({}, "Connection re-tested")}>
                Test now
              </Button>
            </SettingRow>
          )}

          {info.settings.storedKeys.length > 0 && (
            <p className="px-4 pb-3 text-[11px] text-ink-faint">
              These values were set here and override .env.{" "}
              <button
                type="button"
                className="text-accent"
                disabled={busy}
                onClick={() => void save({ udp: null, token: null, stationId: null }, "Using .env values again")}
              >
                Forget in-app settings — use .env again
              </button>
            </p>
          )}
        </>
      )}
    </SettingsSection>
  );
}
