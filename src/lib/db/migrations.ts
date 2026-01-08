import { Database } from "bun:sqlite";

function addColumnIfNotExists(db: Database, table: string, column: string, type: string): boolean {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`  Added column: ${table}.${column}`);
    return true;
  } catch (e: any) {
    // Column already exists - SQLite throws "duplicate column name"
    if (e.message?.includes("duplicate column")) {
      return false;
    }
    throw e;
  }
}

export function runMigrations(db: Database): void {
  console.log("Running database migrations...");

  // Check if webhook_events table exists
  const tableExists = db.query<{ name: string }, []>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='webhook_events'`
  ).get();

  if (tableExists) {
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

    for (const col of webhookColumns) {
      addColumnIfNotExists(db, "webhook_events", col.name, col.type);
    }

    // Add new indexes if they don't exist
    db.exec("CREATE INDEX IF NOT EXISTS idx_webhook_events_action_type ON webhook_events(action_type)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_webhook_events_product_name ON webhook_events(product_name)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at)");
  }

  console.log("Migrations complete.");
}
