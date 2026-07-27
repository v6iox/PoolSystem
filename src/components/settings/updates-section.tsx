"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, CheckCircle2, DownloadCloud, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { apiGet, apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { SettingsSection } from "@/components/settings/section";
import { formatRelative } from "@/lib/utils";

/**
 * Software updates: current vs latest release, manual check, one-tap update
 * (via the updater sidecar), and the nightly auto-update schedule.
 */

interface UpdatesInfo {
  currentVersion: string;
  updateAvailable: boolean;
  state: {
    lastCheckAt: number | null;
    latestVersion: string | null;
    latestTag: string | null;
    latestUrl: string | null;
    lastError: string | null;
  };
  config: { auto: boolean; hour: number };
  updater: { reachable: boolean; busy: boolean; log: string[] };
}

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: h === 0 ? "Midnight" : h === 12 ? "Noon" : h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`,
}));

export function UpdatesSection(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);

  const query = useQuery({
    queryKey: ["updates"],
    queryFn: () => apiGet<UpdatesInfo>("/api/updates"),
    refetchInterval: updating ? 5000 : 5 * 60_000,
  });
  const info = query.data;

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["updates"] });
  };

  const check = async (): Promise<void> => {
    setChecking(true);
    try {
      const res = await apiSend<{ updateAvailable: boolean; state: UpdatesInfo["state"] }>("POST", "/api/updates/check");
      refresh();
      if (res.state.lastError) toast("error", "Check failed", res.state.lastError);
      else if (res.updateAvailable) toast("info", `Update available: ${res.state.latestTag}`);
      else toast("success", "You're up to date");
    } catch (err) {
      toast("error", "Check failed", err instanceof Error ? err.message : undefined);
    } finally {
      setChecking(false);
    }
  };

  const applyNow = async (): Promise<void> => {
    if (!info?.state.latestTag) return;
    setUpdating(true);
    try {
      await apiSend("POST", "/api/updates/apply", { tag: info.state.latestTag });
      toast("info", `Updating to ${info.state.latestTag}…`, "Moonpool rebuilds and restarts itself — this page will reconnect.");
      // The web container is about to be replaced; poll until it's back, then reload.
      const poll = window.setInterval(() => {
        void fetch("/api/auth/status", { cache: "no-store" })
          .then((r) => {
            if (r.ok) {
              window.clearInterval(poll);
              window.location.reload();
            }
          })
          .catch(() => undefined);
      }, 5000);
    } catch (err) {
      setUpdating(false);
      toast("error", "Couldn't start the update", err instanceof Error ? err.message : undefined);
    }
  };

  const setConfig = async (patch: { auto?: boolean; hour?: number }): Promise<void> => {
    try {
      await apiSend("PUT", "/api/updates", patch);
      refresh();
    } catch (err) {
      toast("error", "Couldn't save", err instanceof Error ? err.message : undefined);
    }
  };

  const busy = updating || info?.updater.busy === true;

  return (
    <SettingsSection
      title="Software updates"
      icon={<DownloadCloud size={17} />}
      description="Updates come from GitHub releases and are applied by the updater sidecar."
    >
      <div className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm text-ink">
              {info?.updateAvailable ? (
                <ArrowUpCircle size={16} className="text-warn" />
              ) : (
                <CheckCircle2 size={16} className="text-ok" />
              )}
              Moonpool v{info?.currentVersion ?? "…"}
              {info?.updateAvailable && info.state.latestTag && (
                <span className="rounded-md bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold text-warn">
                  {info.state.latestTag} available
                </span>
              )}
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              {info?.state.lastCheckAt ? `Last checked ${formatRelative(info.state.lastCheckAt)}` : "Not checked yet"}
              {info?.state.lastError ? ` · ${info.state.lastError}` : ""}
              {info?.state.latestUrl && info.updateAvailable ? (
                <>
                  {" · "}
                  <a
                    href={info.state.latestUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-accent"
                  >
                    release notes <ExternalLink size={10} />
                  </a>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void check()} disabled={checking || busy}>
              {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Check for updates
            </Button>
            {info?.updateAvailable && (
              <Button variant="primary" size="sm" onClick={() => void applyNow()} disabled={busy || !info.updater.reachable}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpCircle size={14} />}
                {busy ? "Updating…" : `Update to ${info.state.latestTag}`}
              </Button>
            )}
          </div>
        </div>

        {busy && (
          <div className="mt-3 max-h-40 overflow-y-auto rounded-xl border border-accent/25 bg-abyss/50 p-3">
            <p className="mb-1.5 text-xs font-medium text-accent">Rebuilding — Moonpool will restart itself…</p>
            {(info?.updater.log ?? []).slice(-8).map((line, i) => (
              <p key={i} className="truncate font-mono text-[10.5px] leading-relaxed text-ink-faint">
                {line}
              </p>
            ))}
          </div>
        )}

        {!info?.updater.reachable && info && (
          <p className="mt-3 rounded-lg border border-line bg-abyss/40 px-3 py-2 text-xs text-ink-faint">
            Updater sidecar not reachable — in-app updates need the Docker stack (older installs: re-run install.sh once
            to add it). Manual update: <code className="text-ink-dim">install.sh --update</code>
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div>
            <p className="text-sm text-ink">Update automatically</p>
            <p className="mt-0.5 text-xs text-ink-faint">
              Checks nightly; when a new release exists it installs it for you. Off = you still get a notification.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select
              value={String(info?.config.hour ?? 0)}
              onValueChange={(v) => void setConfig({ hour: Number(v) })}
              options={HOURS}
              aria-label="Nightly check time"
              className="w-36"
            />
            <Switch
              checked={info?.config.auto ?? false}
              onCheckedChange={(auto) => void setConfig({ auto })}
              aria-label="Auto-update"
            />
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
