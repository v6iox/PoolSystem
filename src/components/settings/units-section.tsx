"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, MapPin, Ruler, Thermometer, Waves } from "lucide-react";
import type { AppSettings } from "@/server/settings";
import { usePool } from "@/lib/client/pool-state";
import { apiGet, apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Input, Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/panel";
import { SettingRow, SettingsSection, Segmented } from "@/components/settings/section";

/**
 * App-wide units & format. Family accounts see a read-only view; owners edit.
 * Segments save immediately, number fields save on blur.
 */

interface AppSettingsResponse {
  settings: AppSettings;
}

function NumberCell({
  label,
  value,
  suffix,
  step,
  editable,
  onSave,
}: {
  label: string;
  value: number;
  suffix?: string;
  step?: number;
  editable: boolean;
  onSave: (value: number) => void;
}): React.JSX.Element {
  if (!editable) {
    return (
      <div>
        <Label>{label}</Label>
        <p className="flex h-11 items-center rounded-xl border border-line bg-abyss/30 px-3.5 text-sm text-ink-dim">
          {value}
          {suffix ? <span className="ml-1 text-ink-faint">{suffix}</span> : null}
        </p>
      </div>
    );
  }
  return (
    <div>
      <Label>{label}</Label>
      <div className="relative">
        <Input
          key={value}
          type="number"
          inputMode="decimal"
          step={step}
          defaultValue={value}
          className={suffix ? "pr-14" : undefined}
          onBlur={(e) => {
            const next = Number(e.target.value);
            if (!Number.isFinite(next) || next === value) return;
            onSave(next);
          }}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs text-ink-faint">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function UnitsSection(): React.JSX.Element | null {
  const { user } = usePool();
  const queryClient = useQueryClient();
  const editable = user.role === "owner";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => apiGet<AppSettingsResponse>("/api/settings/app"),
  });

  // Guests can't read app settings; the hub also hides this section for them.
  if (user.role === "guest") return null;

  const save = (patch: Partial<AppSettings>): void => {
    void apiSend<AppSettingsResponse>("PUT", "/api/settings/app", patch)
      .then((res) => {
        queryClient.setQueryData(["app-settings"], res);
        toast("success", "Settings saved");
      })
      .catch((err: unknown) => {
        toast("error", "Couldn't save settings", err instanceof Error ? err.message : undefined);
      });
  };

  const settings = data?.settings;

  return (
    <SettingsSection
      icon={<Ruler size={13} />}
      title="Units & format"
      description={editable ? undefined : "Read-only — only the owner can change these."}
    >
      {isLoading ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-24" />
        </div>
      ) : isError || !settings ? (
        <p className="p-4 text-sm text-ink-dim">Couldn&apos;t load app settings — check the connection and try again.</p>
      ) : (
        <>
          <SettingRow icon={<Thermometer size={17} />} label="Temperature">
            <Segmented
              aria-label="Temperature units"
              value={settings.units}
              onChange={(units) => save({ units })}
              options={[
                { value: "F", label: "°F" },
                { value: "C", label: "°C" },
              ]}
              disabled={!editable}
            />
          </SettingRow>

          <SettingRow icon={<Clock3 size={17} />} label="Clock">
            <Segmented
              aria-label="Clock format"
              value={settings.clock}
              onChange={(clock) => save({ clock })}
              options={[
                { value: "12", label: "12h" },
                { value: "24", label: "24h" },
              ]}
              disabled={!editable}
            />
          </SettingRow>

          <SettingRow
            icon={<Waves size={17} />}
            label="Pool & energy"
            hint="Volume feeds chemistry dosing; kWh cost prices runtime"
            stacked
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumberCell
                label="Pool volume"
                value={settings.poolVolumeGallons}
                suffix="gal"
                step={500}
                editable={editable}
                onSave={(poolVolumeGallons) => save({ poolVolumeGallons })}
              />
              <NumberCell
                label="Cost per kWh"
                value={settings.costPerKwh}
                suffix="$/kWh"
                step={0.01}
                editable={editable}
                onSave={(costPerKwh) => save({ costPerKwh })}
              />
            </div>
          </SettingRow>

          <SettingRow
            icon={<MapPin size={17} />}
            label="Location"
            hint="Drives weather, sunrise & sunset automations"
            stacked
          >
            <div className="grid grid-cols-2 gap-3">
              <NumberCell
                label="Latitude"
                value={settings.latitude}
                step={0.01}
                editable={editable}
                onSave={(latitude) => save({ latitude })}
              />
              <NumberCell
                label="Longitude"
                value={settings.longitude}
                step={0.01}
                editable={editable}
                onSave={(longitude) => save({ longitude })}
              />
            </div>
          </SettingRow>
        </>
      )}
    </SettingsSection>
  );
}
