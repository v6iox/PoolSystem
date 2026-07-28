/**
 * Moonpool updater sidecar.
 *
 * A deliberately tiny service with the two powers the web app must never
 * have: the Docker socket and the source checkout. It does exactly one
 * thing on request: check out a release tag and rebuild the web container.
 *
 *   GET  /status                 → { busy, log, ref }
 *   POST /update {ref, force?}   → 202, then: git fetch → checkout ref → compose build web → up -d web
 *
 * The checkout is forced, which would silently destroy hand-edits made on the
 * Pi — so a dirty tracked tree refuses with 409 + the file list unless the
 * request says force:true. (.env and other untracked files always survive.)
 *
 * Reachable only on the internal compose network; every request must carry
 * Authorization: Bearer <UPDATER_TOKEN> (wired to AUTH_SECRET in compose).
 */
import http from "node:http";
import { execFile } from "node:child_process";
import { hostname } from "node:os";

const PORT = 9888;
const TOKEN = process.env.UPDATER_TOKEN ?? "";
const WORKSPACE = "/workspace";

let busy = false;
let currentRef = "";
const log = [];
/** Progress reporting: phase + 0-100 estimate for the web UI's bar. */
let phase = "idle";
let progress = 0;
let buildSteps = 0;
// Buildkit prints "#N ..." markers; a Moonpool web build typically emits ~35
// distinct steps. Used only to pace the bar — completion is signaled by phase.
const EXPECTED_BUILD_STEPS = 35;

function setPhase(name, pct) {
  phase = name;
  progress = pct;
}

// The docker build's longest steps (npm ci, next build) each sit on ONE
// buildkit marker for minutes — trickle the bar slowly between markers so it
// visibly moves the whole time. Markers always win via Math.max.
let trickleTimer = null;
function startTrickle() {
  stopTrickle();
  trickleTimer = setInterval(() => {
    if (phase === "build" && progress < 88) progress += 1;
  }, 12_000);
}
function stopTrickle() {
  if (trickleTimer) {
    clearInterval(trickleTimer);
    trickleTimer = null;
  }
}

function addLog(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  log.push(stamped);
  if (log.length > 300) log.splice(0, log.length - 300);
  console.log(stamped);
  // Advance the build-phase bar as buildkit step markers stream past.
  if (phase === "build") {
    const marker = /^\s*#(\d+)\b/.exec(line);
    if (marker) {
      buildSteps = Math.max(buildSteps, Number(marker[1]));
      const frac = Math.min(1, buildSteps / EXPECTED_BUILD_STEPS);
      progress = Math.max(progress, Math.round(15 + frac * 75)); // build spans 15→90
    }
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    addLog(`$ ${cmd} ${args.join(" ")}`);
    const child = execFile(
      cmd,
      args,
      {
        cwd: WORKSPACE,
        timeout: 30 * 60_000,
        // A full image-build log can blow past execFile's 1 MB default.
        maxBuffer: 64 * 1024 * 1024,
        ...opts,
        // Force buildkit's line-per-step output even if docker thinks otherwise.
        env: { ...process.env, BUILDKIT_PROGRESS: "plain", ...(opts.env ?? {}) },
      },
      (err, stdout) => {
        if (err) reject(new Error(`${cmd} failed: ${err.message}`));
        else resolve(String(stdout));
      }
    );
    // Stream output line-by-line AS IT HAPPENS — the exit callback above only
    // sees the buffers after the process ends, which for a multi-minute
    // docker build means the progress bar would sit still and then jump.
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      let buf = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        buf += chunk;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) addLog(`  ${trimmed.slice(0, 300)}`);
        }
      });
      stream.on("end", () => {
        const trimmed = buf.trim();
        if (trimmed) addLog(`  ${trimmed.slice(0, 300)}`);
      });
    }
    child.on("error", reject);
  });
}

/**
 * Compose project/files plus this container's own image and the HOST path of
 * the workspace bind — discovered from Docker so the self-refresh helper can
 * mount the same checkout.
 */
async function selfInfo() {
  const inspect = await run("docker", ["inspect", hostname()], { cwd: "/" });
  const info = JSON.parse(inspect)[0] ?? {};
  const labels = info?.Config?.Labels ?? {};
  const project = labels["com.docker.compose.project"] || "moonpool";
  const image = info?.Config?.Image ?? "";
  const workspaceHost = (info?.Mounts ?? []).find((m) => m.Destination === WORKSPACE)?.Source ?? "";
  const files = [`${WORKSPACE}/docker-compose.yml`];
  try {
    await run("test", ["-f", `${WORKSPACE}/docker-compose.override.yml`], { cwd: "/" });
    files.push(`${WORKSPACE}/docker-compose.override.yml`);
  } catch {
    /* no override */
  }
  const args = ["compose", "-p", project, ...files.flatMap((f) => ["-f", f])];
  return { args, project, files, image, workspaceHost };
}

/**
 * The sidecar runs a copy of this script BAKED INTO ITS IMAGE — one-tap
 * updates rebuild only `web`, so without this step updater fixes would never
 * reach existing installs. After a successful update, rebuild the updater
 * image and, if it changed, recreate the sidecar from a detached helper
 * container. (A process can't recreate its own container: it dies at the
 * "stop" half of the recreate and the "start" never gets issued.)
 */
async function refreshSelf(self) {
  try {
    if (!self.image || !self.workspaceHost) return;
    const imageId = async () =>
      (await run("docker", ["image", "inspect", "--format", "{{.Id}}", self.image], { cwd: "/" })).trim();
    const before = await imageId();
    await run("docker", [...self.args, "build", "updater"]);
    if ((await imageId()) === before) return;
    addLog("updater image changed — recreating the sidecar (brief restart of this service)");
    const composeCmd = `docker compose -p ${self.project} ${self.files.map((f) => `-f ${f}`).join(" ")} up -d --no-deps updater`;
    await run(
      "docker",
      [
        "run", "-d", "--rm",
        "-v", "/var/run/docker.sock:/var/run/docker.sock",
        "-v", `${self.workspaceHost}:${WORKSPACE}`,
        self.image,
        "sh", "-c", `sleep 2 && ${composeCmd}`,
      ],
      { cwd: "/" }
    );
  } catch (err) {
    addLog(`sidecar self-refresh skipped: ${err.message}`);
  }
}

/** Tracked files with local modifications — what `checkout -f` would destroy. */
async function localEdits() {
  await run("git", ["config", "--global", "--add", "safe.directory", WORKSPACE], { cwd: "/" });
  const out = await run("git", ["status", "--porcelain"]);
  return out
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("??") && !line.startsWith("!!"))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

async function applyUpdate(ref, force) {
  busy = true;
  currentRef = ref;
  buildSteps = 0;
  try {
    setPhase("fetch", 2);
    await run("git", ["config", "--global", "--add", "safe.directory", WORKSPACE], { cwd: "/" });
    if (force) addLog("force=true — discarding local edits in /workspace");
    await run("git", ["fetch", "--force", "--tags", "origin"]);
    setPhase("checkout", 10);
    await run("git", ["checkout", "-f", ref]);
    const self = await selfInfo();
    setPhase("build", 15);
    startTrickle();
    addLog("building web image (this takes a few minutes on a Pi)…");
    await run("docker", [...self.args, "build", "web"]);
    stopTrickle();
    setPhase("restart", 92);
    addLog("restarting web…");
    await run("docker", [...self.args, "up", "-d", "--no-deps", "web"]);
    setPhase("done", 100);
    addLog(`✓ update to ${ref} complete`);
    await refreshSelf(self);
  } catch (err) {
    setPhase("failed", progress);
    addLog(`✗ update failed: ${err.message}`);
  } finally {
    stopTrickle();
    busy = false;
  }
}

const server = http.createServer((req, res) => {
  const auth = req.headers.authorization ?? "";
  if (!TOKEN || auth !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ busy, ref: currentRef, phase, progress, log: log.slice(-60) }));
    return;
  }
  if (req.method === "POST" && req.url === "/update") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000) req.destroy();
    });
    req.on("end", () => {
      void (async () => {
        let ref = "";
        let force = false;
        try {
          const parsed = JSON.parse(body);
          ref = String(parsed.ref ?? "");
          force = parsed.force === true;
        } catch {
          /* fall through */
        }
        if (!/^[\w./-]{1,80}$/.test(ref)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "bad ref" }));
          return;
        }
        if (busy) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "update already running" }));
          return;
        }
        if (!force) {
          // Refuse rather than destroy: hand-edits in /workspace would be
          // wiped by the forced checkout. .env is untracked and always safe.
          try {
            const edits = await localEdits();
            if (edits.length > 0) {
              addLog(`refusing update: local edits present (${edits.slice(0, 5).join(", ")}${edits.length > 5 ? "…" : ""})`);
              res.writeHead(409, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "local edits would be destroyed", files: edits.slice(0, 20) }));
              return;
            }
          } catch (err) {
            addLog(`dirty-tree check failed (${err.message}) — proceeding`);
          }
        }
        void applyUpdate(ref, force);
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ref }));
      })();
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => addLog(`moonpool updater listening on :${PORT}`));
