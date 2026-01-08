import { Database } from "bun:sqlite";
import { initSchema } from "./schema";
import { mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";

// Resolve database path - use absolute path from project root
const DEFAULT_DB_PATH = resolve(import.meta.dir, "../../../data/products.db");
const DATABASE_PATH = process.env.DATABASE_PATH
  ? resolve(process.env.DATABASE_PATH)
  : DEFAULT_DB_PATH;

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    // Ensure the directory exists
    const dbDir = dirname(DATABASE_PATH);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
      console.log(`Created database directory: ${dbDir}`);
    }

    console.log(`Opening database at: ${DATABASE_PATH}`);
    db = new Database(DATABASE_PATH, { create: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
