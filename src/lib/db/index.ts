import { Database } from "bun:sqlite";
import { initSchema } from "./schema";

const DATABASE_PATH = process.env.DATABASE_PATH || "./data/products.db";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
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
