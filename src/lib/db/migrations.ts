import { Database } from "bun:sqlite";

interface ColumnInfo {
  name: string;
}

function getTableColumns(db: Database, table: string): string[] {
  const columns = db.query<ColumnInfo, []>(
    `PRAGMA table_info(${table})`
  ).all();
  return columns.map(col => col.name);
}

export function runMigrations(db: Database): void {
  console.log("Running database migrations...");

  // Migration 1: Add new columns to webhook_events table
  const webhookColumns = [
    { name: "product_name", type: "TEXT" },
    { name: "product_type", type: "TEXT" },
    { name: "action_type", type: "TEXT" },
    { name: "old_stock_status", type: "TEXT" },
    { name: "new_stock_status", type: "TEXT" },
    { name: "old_stock_quantity", type: "INTEGER" },
    { name: "new_stock_quantity", type: "INTEGER" },
    { name: "stock_change", type: "INTEGER" },
    { name: "meta_retailer_id", type: "TEXT" },
    { name: "processed_at", type: "DATETIME" },
  ];

  // Check if table exists first
  const tableExists = db.query<{ name: string }, []>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='webhook_events'`
  ).get();

  if (tableExists) {
    const existingColumns = getTableColumns(db, "webhook_events");

    for (const col of webhookColumns) {
      if (!existingColumns.includes(col.name)) {
        console.log(`  Adding column: webhook_events.${col.name}`);
        db.exec(`ALTER TABLE webhook_events ADD COLUMN ${col.name} ${col.type}`);
      }
    }

    // Add new indexes if they don't exist
    const indexes = [
      { name: "idx_webhook_events_action_type", sql: "CREATE INDEX IF NOT EXISTS idx_webhook_events_action_type ON webhook_events(action_type)" },
      { name: "idx_webhook_events_product_name", sql: "CREATE INDEX IF NOT EXISTS idx_webhook_events_product_name ON webhook_events(product_name)" },
      { name: "idx_webhook_events_created_at", sql: "CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at)" },
    ];

    for (const idx of indexes) {
      db.exec(idx.sql);
    }
  }

  console.log("Migrations complete.");
}
