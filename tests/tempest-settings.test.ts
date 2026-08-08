import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Tempest settings precedence — same contract as the rest of Moonpool's
 * settings: .env is authoritative until a value is saved in the UI, saved
 * keys are sparse (saving one never freezes the others), and null resets a
 * key so .env wins again.
 */

let tempest: typeof import("@/server/tempest");
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonpool-tempest-"));
  process.env.DATABASE_PATH = path.join(dir, "test.db");
  process.env.TEMPEST_TOKEN = "env-token";
  process.env.TEMPEST_STATION_ID = "111";
  delete process.env.TEMPEST_UDP;
  tempest = await import("@/server/tempest");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("tempest settings precedence", () => {
  it("env values are authoritative on a fresh install, UDP defaults on", () => {
    const { effective, storedKeys } = tempest.getTempestSettings();
    expect(effective).toEqual({ udp: true, token: "env-token", stationId: "111" });
    expect(storedKeys).toEqual([]);
  });

  it("saving one key overrides only that key", () => {
    tempest.saveTempestSettings({ token: "app-token" });
    const { effective, storedKeys } = tempest.getTempestSettings();
    expect(effective.token).toBe("app-token");
    expect(effective.stationId).toBe("111"); // still from env
    expect(storedKeys).toEqual(["token"]);
  });

  it("null resets a key back to env", () => {
    tempest.saveTempestSettings({ token: null, udp: false });
    const { effective, storedKeys } = tempest.getTempestSettings();
    expect(effective.token).toBe("env-token");
    expect(effective.udp).toBe(false);
    expect(storedKeys).toEqual(["udp"]);
  });
});
