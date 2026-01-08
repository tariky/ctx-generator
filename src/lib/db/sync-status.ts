import { getDb } from "./index";

export interface SyncStatus {
  id: number;
  product_id: number;
  meta_retailer_id: string;
  sync_status: "pending" | "synced" | "error";
  meta_product_exists: number;
  last_availability: string | null;
  last_inventory: number | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function upsertSyncStatus(
  productId: number,
  metaRetailerId: string,
  data: Partial<Omit<SyncStatus, "id" | "product_id" | "meta_retailer_id" | "created_at" | "updated_at">>
): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO meta_sync_status (
      product_id, meta_retailer_id, sync_status, meta_product_exists,
      last_availability, last_inventory, last_synced_at, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(meta_retailer_id) DO UPDATE SET
      sync_status = COALESCE(excluded.sync_status, meta_sync_status.sync_status),
      meta_product_exists = COALESCE(excluded.meta_product_exists, meta_sync_status.meta_product_exists),
      last_availability = COALESCE(excluded.last_availability, meta_sync_status.last_availability),
      last_inventory = COALESCE(excluded.last_inventory, meta_sync_status.last_inventory),
      last_synced_at = COALESCE(excluded.last_synced_at, meta_sync_status.last_synced_at),
      last_error = excluded.last_error,
      updated_at = CURRENT_TIMESTAMP
  `);

  stmt.run(
    productId,
    metaRetailerId,
    data.sync_status ?? "pending",
    data.meta_product_exists ?? 0,
    data.last_availability ?? null,
    data.last_inventory ?? null,
    data.last_synced_at ?? null,
    data.last_error ?? null
  );
}

export function getSyncStatusByProductId(productId: number): SyncStatus | null {
  const db = getDb();
  return db.query<SyncStatus, [number]>(
    "SELECT * FROM meta_sync_status WHERE product_id = ?"
  ).get(productId);
}

export function getSyncStatusByRetailerId(metaRetailerId: string): SyncStatus | null {
  const db = getDb();
  return db.query<SyncStatus, [string]>(
    "SELECT * FROM meta_sync_status WHERE meta_retailer_id = ?"
  ).get(metaRetailerId);
}

export function getPendingSyncStatuses(): SyncStatus[] {
  const db = getDb();
  return db.query<SyncStatus, []>(
    "SELECT * FROM meta_sync_status WHERE sync_status = 'pending'"
  ).all();
}

export function getSyncedCount(): number {
  const db = getDb();
  const result = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM meta_sync_status WHERE meta_product_exists = 1"
  ).get();
  return result?.count ?? 0;
}

export function getPendingCount(): number {
  const db = getDb();
  const result = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM meta_sync_status WHERE sync_status = 'pending'"
  ).get();
  return result?.count ?? 0;
}

export function getErrorCount(): number {
  const db = getDb();
  const result = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM meta_sync_status WHERE sync_status = 'error'"
  ).get();
  return result?.count ?? 0;
}

export function deleteSyncStatus(productId: number): void {
  const db = getDb();
  db.run("DELETE FROM meta_sync_status WHERE product_id = ?", [productId]);
}

export function markSynced(
  metaRetailerId: string,
  availability: string,
  inventory: number | null
): void {
  const db = getDb();
  db.run(
    `UPDATE meta_sync_status SET
      sync_status = 'synced',
      meta_product_exists = 1,
      last_availability = ?,
      last_inventory = ?,
      last_synced_at = CURRENT_TIMESTAMP,
      last_error = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE meta_retailer_id = ?`,
    [availability, inventory, metaRetailerId]
  );
}

export function markError(metaRetailerId: string, error: string): void {
  const db = getDb();
  db.run(
    `UPDATE meta_sync_status SET
      sync_status = 'error',
      last_error = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE meta_retailer_id = ?`,
    [error, metaRetailerId]
  );
}
