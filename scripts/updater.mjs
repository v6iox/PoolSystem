/**
 * Moonpool updater sidecar.
 *
 * A deliberately tiny service with the two powers the web app must never
 * have: the Docker socket and the source checkout. It does exactly one
 * thing on request: check out a release tag and rebuild the web container.
 *
 *   GET  /status          → { busy, log, ref }
 *   POST /update {ref}    → 202, then: git fetch → checkout ref → compose build web → up -d web
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

function addLog(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  log.push(stamped);
  if (log.length > 300) log.splice(0, log.length - 300);
  console.log(stamped);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    addLog(`$ ${cmd} ${args.join(" ")}`);
    const child = execFile(cmd, args, { cwd: WORKSPACE, timeout: 30 * 60_000, ...opts }, (err, stdout, stderr) => {
      for (const chunk of [stdout, stderr]) {
        for (const line of String(chunk).split("\n")) {
          const trimmed = line.trim();
          if (trimmed) addLog(`  ${trimmed.slice(0, 300)}`);
        }
      }
      if (err) reject(new Error(`${cmd} failed: ${err.message}`));
      else resolve(String(stdout));
    });
    child.on("error", reject);
  });
}

/** Compose project name + files, discovered from this container's own labels. */
async function composeArgs() {
  const inspect = await run("docker", ["inspect", hostname()], { cwd: "/" });
  const info = JSON.parse(inspect)[0];
  const labels = info?.Config?.Labels ?? {};
  const project = labels["com.docker.compose.project"] || "moonpool";
  const args = ["compose", "-p", project, "-f", `${WORKSPACE}/docker-compose.yml`];
  try {
    await run("test", ["-f", `${WORKSPACE}/docker-compose.override.yml`], { cwd: "/" });
    args.push("-f", `${WORKSPACE}/docker-compose.override.yml`);
  } catch {
    /* no override */
  }
  return args;
}

async function applyUpdate(ref) {
  busy = true;
  currentRef = ref;
  try {
    await run("git", ["config", "--global", "--add", "safe.directory", WORKSPACE], { cwd: "/" });
    await run("git", ["fetch", "--force", "--tags", "origin"]);
    await run("git", ["checkout", "-f", ref]);
    const compose = await composeArgs();
    addLog("building web image (this takes a few minutes on a Pi)…");
    await run("docker", [...compose, "build", "web"]);
    addLog("restarting web…");
    await run("docker", [...compose, "up", "-d", "--no-deps", "web"]);
    addLog(`✓ update to ${ref} complete`);
  } catch (err) {
    addLog(`✗ update failed: ${err.message}`);
  } finally {
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
    res.end(JSON.stringify({ busy, ref: currentRef, log: log.slice(-60) }));
    return;
  }
  if (req.method === "POST" && req.url === "/update") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000) req.destroy();
    });
    req.on("end", () => {
      let ref = "";
      try {
        ref = String(JSON.parse(body).ref ?? "");
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
      void applyUpdate(ref);
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ref }));
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => addLog(`moonpool updater listening on :${PORT}`));
