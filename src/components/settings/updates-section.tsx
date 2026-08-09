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
  updater: { reachable: boolean; busy: boolean; phase: string; progress: number; stale: boolean; log: string[] };
  installKind: "docker" | "source";
}

const REFRESH_CMD = "cd ~/moonpool && docker compose build updater && docker compose up -d updater";

const PHASE_LABELS: Record<string, string> = {
  fetch: "Fetching the release…",
  checkout: "Checking out the new version…",
  build: "Building the new image — the long part…",
  restart: "Restarting Moonpool…",
  done: "Update complete",
  failed: "Update failed — see the log below",
};

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

  const [localEdits, setLocalEdits] = useState<string[] | null>(null);

  const applyNow = async (force = false): Promise<void> => {
    if (!info?.state.latestTag) return;
    setUpdating(true);
    setLocalEdits(null);
    try {
      const res = await fetch("/api/updates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: info.state.latestTag, force }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; localEdits?: string[] };
        if (Array.isArray(body.localEdits) && body.localEdits.length > 0) {
          // Hand-edits on the install would be wiped — show them and let the
          // owner decide instead of destroying silently.
          setLocalEdits(body.localEdits);
          setUpdating(false);
          return;
        }
        throw new Error(body.error ?? `Update failed (${res.status})`);
      }
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

        {localEdits && (
          <div className="mt-3 rounded-xl border border-warn/30 bg-warn/10 p-3">
            <p className="text-xs font-medium text-warn">
              This install has hand-edited files that the update would erase:
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {localEdits.map((f) => (
                <li key={f} className="font-mono text-[11px] text-ink-dim">
                  {f}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink-faint">
              Changes belong in the repo (use scripts/pi-deploy.sh for testing); .env always survives. Updating anyway
              discards the edits above permanently.
            </p>
            <div className="mt-2 flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => void applyNow(true)}>
                Update anyway — discard those edits
              </Button>
              <Button variant="glass" size="sm" onClick={() => setLocalEdits(null)}>
                Keep my edits
              </Button>
            </div>
          </div>
        )}

        {busy && (
          <div className="mt-3 max-h-48 overflow-y-auto rounded-xl border border-accent/25 bg-abyss/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-accent">
                {PHASE_LABELS[info?.updater.phase ?? ""] ?? "Rebuilding — Moonpool will restart itself…"}
              </p>
              <span className="text-xs tabular-nums text-ink-dim">{info?.updater.progress ?? 0}%</span>
            </div>
            <div className="mb-2.5 h-2 overflow-hidden rounded-full bg-abyss/70">
              <div
                className="h-full rounded-full bg-accent transition-all duration-700"
                style={{ width: `${Math.max(2, info?.updater.progress ?? 0)}%` }}
              />
            </div>
            {(info?.updater.log ?? []).slice(-8).map((line, i) => (
              <p key={i} className="truncate font-mono text-[10.5px] leading-relaxed text-ink-faint">
                {line}
              </p>
            ))}
          </div>
        )}

        {info?.updater.reachable && info.updater.stale && (
          <div className="mt-3 rounded-xl border border-warn/30 bg-warn/10 p-3">
            <p className="text-xs font-medium text-warn">
              One-time step needed: the updater helper on this Pi is an older version
            </p>
            <p className="mt-1.5 text-xs text-ink-faint">
              Updates still work, but the live progress bar (and the helper keeping itself current) need the newer
              helper — and the helper can&apos;t rebuild itself from the old version. Run this once over SSH; after
              that it stays up to date automatically:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg bg-abyss/60 px-2.5 py-1.5 font-mono text-[11px] text-ink-dim">
                {REFRESH_CMD}
              </code>
              <Button
                variant="glass"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(REFRESH_CMD).then(
                    () => toast("success", "Command copied"),
                    () => toast("error", "Couldn't copy — select the text manually")
                  );
                }}
              >
                Copy
              </Button>
            </div>
          </div>
        )}

        {info && !info.updater.reachable && (
          <p className="mt-3 rounded-lg border border-line bg-abyss/40 px-3 py-2 text-xs text-ink-faint">
            {info.installKind === "source" ? (
              <>
                Running from a source checkout (dev) — one-tap updates apply to the Docker install on the Pi. Update
                this checkout with <code className="text-ink-dim">git pull</code>. Checking for new releases still works
                above.
              </>
            ) : (
              <>
                Updater sidecar not reachable — older installs: re-run install.sh once to add it. Manual update:{" "}
                <code className="text-ink-dim">install.sh --update</code>
              </>
            )}
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
