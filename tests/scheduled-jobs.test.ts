import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTooLate } from "@/server/automations/worker";

/**
 * One-shot job bookkeeping. These exercise the SQL that decides whether a job
 * runs, gets claimed, or is written off — the part that made a Pi coming back
 * from an overnight outage fire last night's "heat the spa" at breakfast, and
 * that lost a job outright if the process died mid-run.
 */

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "src/server/db/schema.sql"), "utf8");

let db: Database.Database;
let file: string;

beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "moonpool-test-")), "test.db");
  db = new Database(file);
  db.exec(SCHEMA);
});

afterEach(() => {
  db.close();
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

function addJob(fireAt: number, label = "spa heat"): number {
  const res = db
    .prepare(
      `INSERT INTO scheduled_jobs (label, actions, fire_at, created_by, source, status, created_at)
       VALUES (?, '[]', ?, NULL, 'copilot', 'pending', ?)`
    )
    .run(label, fireAt, Date.now());
  return Number(res.lastInsertRowid);
}

const claim = (id: number, at: number): number =>
  db
    .prepare("UPDATE scheduled_jobs SET executed_at = ? WHERE id = ? AND status = 'pending' AND executed_at IS NULL")
    .run(at, id).changes;

describe("staleness window", () => {
  const grace = 30 * 60_000;

  it("runs a job that is due now", () => {
    expect(isTooLate(1_000_000, 1_000_000, grace)).toBe(false);
  });

  it("runs a job a few minutes late", () => {
    expect(isTooLate(1_000_000, 1_000_000 + 5 * 60_000, grace)).toBe(false);
  });

  it("writes off a job from an overnight outage", () => {
    expect(isTooLate(1_000_000, 1_000_000 + 9 * 3600_000, grace)).toBe(true);
  });

  it("is exclusive at the boundary", () => {
    expect(isTooLate(0, grace, grace)).toBe(false);
    expect(isTooLate(0, grace + 1, grace)).toBe(true);
  });
});

describe("claiming", () => {
  it("only lets one poll tick take a job", () => {
    const id = addJob(Date.now() - 1000);
    expect(claim(id, Date.now())).toBe(1);
    // A second tick — or a second Node process on the same file — gets nothing.
    expect(claim(id, Date.now())).toBe(0);
  });

  it("leaves an unclaimed job selectable", () => {
    const id = addJob(Date.now() - 1000);
    const due = db
      .prepare("SELECT id FROM scheduled_jobs WHERE status = 'pending' AND executed_at IS NULL AND fire_at <= ?")
      .all(Date.now()) as Array<{ id: number }>;
    expect(due.map((r) => r.id)).toEqual([id]);
  });

  it("does not select a job that is not due yet", () => {
    addJob(Date.now() + 3600_000);
    const due = db
      .prepare("SELECT id FROM scheduled_jobs WHERE status = 'pending' AND executed_at IS NULL AND fire_at <= ?")
      .all(Date.now());
    expect(due).toEqual([]);
  });
});

describe("crash recovery", () => {
  const sweep = (): number =>
    db
      .prepare("UPDATE scheduled_jobs SET status = 'error', result = ? WHERE status = 'pending' AND executed_at IS NOT NULL")
      .run("interrupted by a restart — not run").changes;

  it("writes off a job that was claimed but never finished", () => {
    const id = addJob(Date.now() - 1000);
    claim(id, Date.now());
    expect(sweep()).toBe(1);
    const row = db.prepare("SELECT status, result FROM scheduled_jobs WHERE id = ?").get(id) as {
      status: string;
      result: string;
    };
    expect(row.status).toBe("error");
    expect(row.result).toMatch(/interrupted/);
  });

  it("leaves untouched jobs pending across a restart", () => {
    const id = addJob(Date.now() + 3600_000);
    expect(sweep()).toBe(0);
    const row = db.prepare("SELECT status FROM scheduled_jobs WHERE id = ?").get(id) as { status: string };
    expect(row.status).toBe("pending");
  });

  it("does not touch jobs that already completed", () => {
    const id = addJob(Date.now() - 1000);
    claim(id, Date.now());
    db.prepare("UPDATE scheduled_jobs SET status = 'done' WHERE id = ?").run(id);
    expect(sweep()).toBe(0);
  });
});
