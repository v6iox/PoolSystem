import pkg from "../../package.json";
import { getSetting, setSetting } from "@/server/settings";
import { audit } from "@/server/audit";
import { sendAlert } from "@/server/push";

/**
 * Auto-update manager. The app checks GitHub Releases (public API, no auth),
 * decides, and — when an update should happen — asks the updater sidecar
 * (the only container with the Docker socket) to check out the release tag
 * and rebuild the web container. Schedule is user-configurable; default is
 * a nightly check at midnight with auto-apply off until enabled.
 */

export const CURRENT_VERSION: string = (pkg as { version: string }).version;

const REPO_SLUG = process.env.MOONPOOL_REPO_SLUG ?? "v6iox/poolsystem";
const UPDATER_URL = process.env.UPDATER_URL ?? "";
const UPDATER_TOKEN = process.env.AUTH_SECRET ?? "";

export interface UpdateConfig {
  /** Apply updates automatically when found (checks still run either way). */
  auto: boolean;
  /** Local hour (0-23) for the nightly check. */
  hour: number;
}

export interface UpdateState {
  lastCheckAt: number | null;
  latestVersion: string | null;
  latestTag: string | null;
  latestUrl: string | null;
  latestNotes: string | null;
  lastError: string | null;
  lastAppliedTag: string | null;
  lastAppliedAt: number | null;
  lastAutoDay: string | null;
}

const DEFAULT_CONFIG: UpdateConfig = { auto: false, hour: 0 };
const DEFAULT_STATE: UpdateState = {
  lastCheckAt: null,
  latestVersion: null,
  latestTag: null,
  latestUrl: null,
  latestNotes: null,
  lastError: null,
  lastAppliedTag: null,
  lastAppliedAt: null,
  lastAutoDay: null,
};

export function getUpdateConfig(): UpdateConfig {
  return { ...DEFAULT_CONFIG, ...getSetting<Partial<UpdateConfig>>("updatesConfig", {}) };
}

export function saveUpdateConfig(patch: Partial<UpdateConfig>): UpdateConfig {
  const merged = { ...getUpdateConfig(), ...patch };
  merged.hour = Math.min(23, Math.max(0, Math.round(merged.hour)));
  setSetting("updatesConfig", merged);
  return merged;
}

export function getUpdateState(): UpdateState {
  return { ...DEFAULT_STATE, ...getSetting<Partial<UpdateState>>("updatesState", {}) };
}

function saveState(patch: Partial<UpdateState>): UpdateState {
  const merged = { ...getUpdateState(), ...patch };
  setSetting("updatesState", merged);
  return merged;
}

/** "v1.2.3" → [1,2,3]; robust to missing parts. */
function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, "")
    .split(".")
    .map((p) => Number.parseInt(p, 10) || 0);
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export async function checkForUpdate(): Promise<UpdateState> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_SLUG}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "moonpool-updater" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) {
      return saveState({ lastCheckAt: Date.now(), lastError: "No releases found (repo private or no release yet)" });
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const json = (await res.json()) as { tag_name?: string; html_url?: string; body?: string };
    const tag = json.tag_name ?? "";
    return saveState({
      lastCheckAt: Date.now(),
      latestTag: tag,
      latestVersion: tag.replace(/^v/i, ""),
      latestUrl: json.html_url ?? null,
      latestNotes: (json.body ?? "").slice(0, 4000),
      lastError: null,
    });
  } catch (err) {
    return saveState({
      lastCheckAt: Date.now(),
      lastError: err instanceof Error ? err.message : "check failed",
    });
  }
}

/** "docker" = full stack with the updater sidecar; "source" = running from a checkout (dev). */
export function installKind(): "docker" | "source" {
  return UPDATER_URL ? "docker" : "source";
}

export interface UpdaterStatus {
  reachable: boolean;
  busy: boolean;
  /** "idle" | "fetch" | "checkout" | "build" | "restart" | "done" | "failed" */
  phase: string;
  /** 0–100 estimate for the progress bar. */
  progress: number;
  log: string[];
}

const OFFLINE: UpdaterStatus = { reachable: false, busy: false, phase: "idle", progress: 0, log: [] };

export async function getUpdaterStatus(): Promise<UpdaterStatus> {
  if (!UPDATER_URL) return OFFLINE;
  try {
    const res = await fetch(`${UPDATER_URL}/status`, {
      headers: { Authorization: `Bearer ${UPDATER_TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return OFFLINE;
    const json = (await res.json()) as { busy?: boolean; phase?: string; progress?: number; log?: string[] };
    return {
      reachable: true,
      busy: json.busy === true,
      phase: typeof json.phase === "string" ? json.phase : "idle",
      progress: typeof json.progress === "number" ? Math.max(0, Math.min(100, json.progress)) : 0,
      log: json.log ?? [],
    };
  } catch {
    return OFFLINE;
  }
}

export async function applyUpdate(
  tag: string,
  initiatedBy: string,
  force = false
): Promise<{ ok: boolean; error?: string; localEdits?: string[] }> {
  if (!UPDATER_URL) return { ok: false, error: "Updater sidecar not available (dev mode or old install — run install.sh --update)" };
  try {
    const res = await fetch(`${UPDATER_URL}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${UPDATER_TOKEN}` },
      body: JSON.stringify({ ref: tag, force }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; files?: string[] };
      if (Array.isArray(body.files) && body.files.length > 0) {
        // Hand-edits on the Pi would be destroyed — refuse and surface them.
        return {
          ok: false,
          error: "Local edits in the install would be lost by this update.",
          localEdits: body.files,
        };
      }
      return { ok: false, error: body.error ?? `updater returned ${res.status}` };
    }
    saveState({ lastAppliedTag: tag, lastAppliedAt: Date.now() });
    audit({
      userId: null,
      userName: initiatedBy,
      source: "system",
      action: "applyUpdate",
      target: "moonpool",
      oldValue: `v${CURRENT_VERSION}`,
      newValue: tag,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "updater unreachable" };
  }
}

/** Called every few minutes by the runtime — runs the nightly check window. */
export async function updateTick(): Promise<void> {
  const config = getUpdateConfig();
  const now = new Date();
  if (now.getHours() !== config.hour) return;
  const today = now.toLocaleDateString("sv-SE");
  const state = getUpdateState();
  if (state.lastAutoDay === today) return;
  saveState({ lastAutoDay: today });

  const fresh = await checkForUpdate();
  if (!fresh.latestTag || !fresh.latestVersion) return;
  if (!isNewer(fresh.latestVersion, CURRENT_VERSION)) return;

  if (config.auto) {
    const status = await getUpdaterStatus();
    if (status.reachable && !status.busy) {
      await applyUpdate(fresh.latestTag, "auto-update");
    }
  } else {
    // Auto-apply off → just let people know an update exists.
    void sendAlert(
      "equipmentFault",
      "Moonpool update available",
      `${fresh.latestTag} is out (you're on v${CURRENT_VERSION}). Update from Settings → System.`
    ).catch(() => undefined);
  }
}

let ticker: ReturnType<typeof setInterval> | null = null;

export function startUpdateScheduler(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    void updateTick().catch(() => undefined);
  }, 5 * 60_000);
}
