import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Settings precedence: .env is authoritative until the owner explicitly saves
 * a value in the UI — and ONLY for the keys actually saved. Historically,
 * saving anything (even the clock format) persisted the whole merged object,
 * silently freezing env-derived coordinates into the DB forever.
 */

let settings: typeof import("@/server/settings");
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonpool-settings-"));
  process.env.DATABASE_PATH = path.join(dir, "test.db");
  process.env.POOL_LATITUDE = "11.5";
  process.env.POOL_LONGITUDE = "-42.25";
  settings = await import("@/server/settings");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("app settings precedence", () => {
  it("env coordinates are authoritative on a fresh install", () => {
    expect(settings.getAppSettings().latitude).toBe(11.5);
    expect(settings.getAppSettings().longitude).toBe(-42.25);
    expect(settings.storedAppKeys()).toEqual([]);
  });

  it("saving one setting does not freeze the others into the DB", () => {
    settings.saveAppSettings({ clock: "24" });
    expect(settings.storedAppKeys()).toEqual(["clock"]);
    // .env still owns the location — the old behavior stored latitude too.
    expect(settings.getAppSettings().latitude).toBe(11.5);
  });

  it("an explicit save overrides env for that key only", () => {
    settings.saveAppSettings({ latitude: 40.1 });
    expect(settings.getAppSettings().latitude).toBe(40.1);
    expect(settings.getAppSettings().longitude).toBe(-42.25);
    expect(settings.storedAppKeys().sort()).toEqual(["clock", "latitude"]);
  });

  it("null forgets the saved value and hands authority back to env", () => {
    settings.saveAppSettings({ latitude: null });
    expect(settings.getAppSettings().latitude).toBe(11.5);
    expect(settings.storedAppKeys()).toEqual(["clock"]);
  });
});
