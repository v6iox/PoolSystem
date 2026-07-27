"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellOff,
  BellRing,
  Droplets,
  Flame,
  FlaskConical,
  Loader2,
  Snowflake,
  Thermometer,
  TriangleAlert,
  Waves,
  WifiOff,
  Zap,
} from "lucide-react";
import { apiGet, apiSend } from "@/lib/client/api";
import { getPushStatus, subscribeToPush, unsubscribeFromPush, type PushStatus } from "@/lib/client/push";
import { toast } from "@/stores/toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/panel";
import { SettingRow, SettingsSection, StatusPill } from "@/components/settings/section";

/**
 * Push alerts: one master enable per device (web-push subscription) plus
 * per-alert preferences stored in the user's prefs blob. Alerts default ON —
 * the server only skips a kind when it is explicitly false.
 */

type AlertToggleKind =
  | "equipmentFault"
  | "freezeProtect"
  | "saltLow"
  | "chemistryOutOfRange"
  | "spaAtTemp"
  | "heaterStall"
  | "njspcOffline"
  | "waterLow"
  | "lightning";

const ALERT_TOGGLES: Array<{ kind: AlertToggleKind; label: string; hint: string; icon: React.ReactNode }> = [
  { kind: "equipmentFault", label: "Equipment fault", hint: "Pump, chlorinator or panel errors", icon: <TriangleAlert size={17} /> },
  { kind: "freezeProtect", label: "Freeze protection", hint: "When freeze protection kicks in", icon: <Snowflake size={17} /> },
  { kind: "saltLow", label: "Salt low", hint: "Chlorinator salt below the threshold", icon: <Droplets size={17} /> },
  { kind: "chemistryOutOfRange", label: "Chemistry out of range", hint: "pH / sanitizer outside ideal bands", icon: <FlaskConical size={17} /> },
  { kind: "spaAtTemp", label: "Spa at temperature", hint: "Soak's ready — spa reached its setpoint", icon: <Thermometer size={17} /> },
  { kind: "heaterStall", label: "Heater not heating", hint: "Says it's heating but the water isn't warming, or it quit mid-heat", icon: <Flame size={17} /> },
  { kind: "njspcOffline", label: "Controller offline", hint: "Moonpool lost the pool controller", icon: <WifiOff size={17} /> },
  { kind: "waterLow", label: "Water level low", hint: "Evaporation estimate says it's time to top off", icon: <Waves size={17} /> },
  { kind: "lightning", label: "Lightning nearby", hint: "Tempest strike detection — out of the pool", icon: <Zap size={17} /> },
];

interface PrefsResponse {
  prefs: {
    notifications?: Partial<Record<string, boolean>>;
  };
}

export function NotificationsSection(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [pushStatus, setPushStatus] = useState<PushStatus | "checking">("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPushStatus().then((status) => {
      if (!cancelled) setPushStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const prefsQuery = useQuery({
    queryKey: ["user-prefs"],
    queryFn: () => apiGet<PrefsResponse>("/api/settings/prefs"),
  });
  const notifications = prefsQuery.data?.prefs.notifications ?? {};

  const enable = async (): Promise<void> => {
    setBusy(true);
    const ok = await subscribeToPush();
    if (ok) {
      setPushStatus("subscribed");
      toast("success", "Alerts enabled", "This device will now receive pool alerts.");
    }
    setBusy(false);
  };

  const disable = async (): Promise<void> => {
    setBusy(true);
    const ok = await unsubscribeFromPush();
    if (ok) {
      setPushStatus("unsubscribed");
      toast("info", "Alerts disabled", "This device will no longer receive pool alerts.");
    }
    setBusy(false);
  };

  const toggleAlert = (kind: AlertToggleKind, on: boolean): void => {
    const next: Partial<Record<string, boolean>> = { ...notifications, [kind]: on };
    // Optimistic cache update, rolled back on failure.
    const previous = prefsQuery.data;
    queryClient.setQueryData<PrefsResponse>(["user-prefs"], (old) => ({
      prefs: { ...(old?.prefs ?? {}), notifications: next },
    }));
    void apiSend<PrefsResponse>("PUT", "/api/settings/prefs", { notifications: next }).catch((err: unknown) => {
      queryClient.setQueryData(["user-prefs"], previous);
      toast("error", "Couldn't save preference", err instanceof Error ? err.message : undefined);
    });
  };

  const subscribed = pushStatus === "subscribed";

  return (
    <SettingsSection
      icon={<Bell size={13} />}
      title="Notifications"
      description="Push alerts arrive even when Moonpool is closed."
    >
      <SettingRow
        icon={subscribed ? <BellRing size={17} className="text-accent" /> : <Bell size={17} />}
        label="Alerts on this device"
        hint={
          pushStatus === "unsupported"
            ? "This browser can't receive web push. On iPhone/iPad, install Moonpool to the home screen first."
            : subscribed
              ? "Subscribed — pool alerts will push to this device."
              : "Enable to get pool alerts pushed here."
        }
      >
        {pushStatus === "checking" ? (
          <Skeleton className="h-8 w-24 rounded-xl" />
        ) : pushStatus === "unsupported" ? (
          <StatusPill tone="neutral">Unavailable</StatusPill>
        ) : subscribed ? (
          <Button variant="glass" size="sm" disabled={busy} onClick={() => void disable()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <BellOff size={14} />}
            Disable
          </Button>
        ) : (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void enable()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />}
            Enable
          </Button>
        )}
      </SettingRow>

      {prefsQuery.isLoading ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : (
        ALERT_TOGGLES.map((alert) => (
          <SettingRow key={alert.kind} icon={alert.icon} label={alert.label} hint={alert.hint}>
            <Switch
              checked={notifications[alert.kind] !== false}
              onCheckedChange={(on) => toggleAlert(alert.kind, on)}
              disabled={prefsQuery.isError}
              aria-label={alert.label}
            />
          </SettingRow>
        ))
      )}
    </SettingsSection>
  );
}
