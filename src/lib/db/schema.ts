import { Database } from "bun:sqlite";

export function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER DEFAULT 0,
      type TEXT NOT NULL,
      meta_retailer_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      sku TEXT,
      permalink TEXT,
      price TEXT,
      regular_price TEXT,
      sale_price TEXT,
      stock_status TEXT NOT NULL,
      stock_quantity INTEGER,
      description TEXT,
      image_url TEXT,
      attributes TEXT,
      variations TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS meta_sync_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      meta_retailer_id TEXT UNIQUE NOT NULL,
      sync_status TEXT DEFAULT 'pending',
      meta_product_exists INTEGER DEFAULT 0,
      last_availability TEXT,
      last_inventory INTEGER,
      last_synced_at DATETIME,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      wc_product_id INTEGER NOT NULL,
      product_name TEXT,
      product_type TEXT,
      action_type TEXT,
      old_stock_status TEXT,
      new_stock_status TEXT,
      old_stock_quantity INTEGER,
      new_stock_quantity INTEGER,
      stock_change INTEGER,
      meta_retailer_id TEXT,
      payload TEXT NOT NULL,
      signature TEXT,
      processed INTEGER DEFAULT 0,
      processed_at DATETIME,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_products_parent_id ON products(parent_id);
    CREATE INDEX IF NOT EXISTS idx_products_stock_status ON products(stock_status);
    CREATE INDEX IF NOT EXISTS idx_products_meta_retailer_id ON products(meta_retailer_id);
    CREATE INDEX IF NOT EXISTS idx_meta_sync_status_sync_status ON meta_sync_status(sync_status);
    CREATE INDEX IF NOT EXISTS idx_meta_sync_status_product_id ON meta_sync_status(product_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed);
    CREATE INDEX IF NOT EXISTS idx_webhook_events_wc_product_id ON webhook_events(wc_product_id);
  `);
  // Note: indexes for action_type, product_name, created_at are created in migrations.ts
  // after the columns are added to existing tables
}
