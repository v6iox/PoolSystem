import os from "node:os";
import fs from "node:fs";
import path from "node:path";

/**
 * Live host health for the Settings → System page. CPU% is measured between
 * successive calls (the client polls every few seconds, which IS the sample
 * window); everything else is read fresh per call. Works the same on a Pi,
 * a Mac, or inside Docker — fields that don't exist (Pi CPU temp on a Mac)
 * come back null and the UI skips them.
 */

export interface SystemStats {
  cpuPct: number;
  cores: number;
  loadAvg1: number;
  memTotalMb: number;
  memUsedMb: number;
  /** Moonpool's own resident set size. */
  processRssMb: number;
  /** SoC temperature (Raspberry Pi & friends), °C. */
  cpuTempC: number | null;
  diskTotalGb: number | null;
  diskFreeGb: number | null;
  osUptimeSec: number;
  processUptimeSec: number;
  platform: string;
  nodeVersion: string;
}

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

let lastCpu = cpuTimes();
let lastPct = 0;

export function getSystemStats(): SystemStats {
  const nowCpu = cpuTimes();
  const dTotal = nowCpu.total - lastCpu.total;
  const dIdle = nowCpu.idle - lastCpu.idle;
  if (dTotal > 0) lastPct = Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100));
  lastCpu = nowCpu;

  let cpuTempC: number | null = null;
  try {
    const raw = Number(fs.readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8").trim());
    if (Number.isFinite(raw) && raw > 0) cpuTempC = Math.round(raw / 100) / 10;
  } catch {
    // no thermal zone (not a Pi / not Linux)
  }

  let diskTotalGb: number | null = null;
  let diskFreeGb: number | null = null;
  try {
    const dataDir = path.dirname(process.env.DATABASE_PATH ?? "./data/moonpool.db");
    const stat = fs.statfsSync(fs.existsSync(dataDir) ? dataDir : ".");
    diskTotalGb = Math.round(((stat.blocks * stat.bsize) / 1e9) * 10) / 10;
    diskFreeGb = Math.round(((stat.bavail * stat.bsize) / 1e9) * 10) / 10;
  } catch {
    // statfs unavailable
  }

  const memTotal = os.totalmem();
  return {
    cpuPct: Math.round(lastPct),
    cores: os.cpus().length,
    loadAvg1: Math.round((os.loadavg()[0] ?? 0) * 100) / 100,
    memTotalMb: Math.round(memTotal / 1048576),
    memUsedMb: Math.round((memTotal - os.freemem()) / 1048576),
    processRssMb: Math.round(process.memoryUsage().rss / 1048576),
    cpuTempC,
    diskTotalGb,
    diskFreeGb,
    osUptimeSec: Math.round(os.uptime()),
    processUptimeSec: Math.round(process.uptime()),
    platform: `${os.type()} ${os.arch()}`,
    nodeVersion: process.version,
  };
}
