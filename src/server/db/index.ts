import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Single local SQLite database. WAL mode keeps reads cheap while the runtime
 * writes history samples. The schema file is idempotent (CREATE IF NOT EXISTS)
 * so it doubles as the migration: it is re-applied on every boot.
 */

const globalForDb = globalThis as unknown as { __moonpoolDb?: Database.Database };

function open(): Database.Database {
  const dbPath = process.env.DATABASE_PATH ?? "./data/moonpool.db";
  const dir = path.dirname(path.resolve(dbPath));
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const schema = fs.readFileSync(path.join(process.cwd(), "src/server/db/schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

export function getDb(): Database.Database {
  if (!globalForDb.__moonpoolDb) {
    globalForDb.__moonpoolDb = open();
  }
  return globalForDb.__moonpoolDb;
}

export function now(): number {
  return Date.now();
}

/** Local calendar day (YYYY-MM-DD) in the configured TZ. */
export function localDay(at: number = Date.now()): string {
  const d = new Date(at);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
