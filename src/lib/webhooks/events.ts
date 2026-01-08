import { getDb } from "../db/index";

export interface WebhookEvent {
  id: number;
  topic: string;
  wc_product_id: number;
  product_name: string | null;
  product_type: string | null;
  action_type: string | null;
  old_stock_status: string | null;
  new_stock_status: string | null;
  old_stock_quantity: number | null;
  new_stock_quantity: number | null;
  stock_change: number | null;
  meta_retailer_id: string | null;
  payload: string;
  signature: string | null;
  processed: number;
  processed_at: string | null;
  error: string | null;
  created_at: string;
}

export interface WebhookEventDetails {
  productName?: string;
  productType?: string;
  actionType?: "created" | "updated" | "deleted" | "restored";
  oldStockStatus?: string;
  newStockStatus?: string;
  oldStockQuantity?: number;
  newStockQuantity?: number;
  metaRetailerId?: string;
}

export interface WebhookSearchParams {
  search?: string;
  actionType?: string;
  productId?: number;
  processed?: boolean;
  hasError?: boolean;
  limit?: number;
  offset?: number;
}

export interface WebhookSearchResult {
  events: WebhookEvent[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function logWebhookEvent(
  topic: string,
  wcProductId: number,
  payload: string,
  signature: string | null,
  details?: WebhookEventDetails
): number {
  const db = getDb();

  // Calculate stock change if both old and new quantities are provided
  let stockChange: number | null = null;
  if (details?.oldStockQuantity !== undefined && details?.newStockQuantity !== undefined) {
    stockChange = details.newStockQuantity - details.oldStockQuantity;
  }

  const stmt = db.prepare(`
    INSERT INTO webhook_events (
      topic, wc_product_id, product_name, product_type, action_type,
      old_stock_status, new_stock_status, old_stock_quantity, new_stock_quantity,
      stock_change, meta_retailer_id, payload, signature
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    topic,
    wcProductId,
    details?.productName ?? null,
    details?.productType ?? null,
    details?.actionType ?? null,
    details?.oldStockStatus ?? null,
    details?.newStockStatus ?? null,
    details?.oldStockQuantity ?? null,
    details?.newStockQuantity ?? null,
    stockChange,
    details?.metaRetailerId ?? null,
    payload,
    signature
  );

  return Number(result.lastInsertRowid);
}

export function updateWebhookEventDetails(
  eventId: number,
  details: WebhookEventDetails
): void {
  const db = getDb();

  let stockChange: number | null = null;
  if (details.oldStockQuantity !== undefined && details.newStockQuantity !== undefined) {
    stockChange = details.newStockQuantity - details.oldStockQuantity;
  }

  db.run(
    `UPDATE webhook_events SET
      product_name = COALESCE(?, product_name),
      product_type = COALESCE(?, product_type),
      action_type = COALESCE(?, action_type),
      old_stock_status = COALESCE(?, old_stock_status),
      new_stock_status = COALESCE(?, new_stock_status),
      old_stock_quantity = COALESCE(?, old_stock_quantity),
      new_stock_quantity = COALESCE(?, new_stock_quantity),
      stock_change = COALESCE(?, stock_change),
      meta_retailer_id = COALESCE(?, meta_retailer_id)
    WHERE id = ?`,
    [
      details.productName ?? null,
      details.productType ?? null,
      details.actionType ?? null,
      details.oldStockStatus ?? null,
      details.newStockStatus ?? null,
      details.oldStockQuantity ?? null,
      details.newStockQuantity ?? null,
      stockChange,
      details.metaRetailerId ?? null,
      eventId,
    ]
  );
}

export function markWebhookProcessed(eventId: number): void {
  const db = getDb();
  db.run(
    `UPDATE webhook_events SET processed = 1, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [eventId]
  );
}

export function markWebhookError(eventId: number, error: string): void {
  const db = getDb();
  db.run(
    `UPDATE webhook_events SET error = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [error, eventId]
  );
}

export function searchWebhookEvents(params: WebhookSearchParams): WebhookSearchResult {
  const db = getDb();
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  // Build WHERE clause
  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (params.search) {
    conditions.push("(product_name LIKE ? OR CAST(wc_product_id AS TEXT) LIKE ? OR meta_retailer_id LIKE ?)");
    const searchTerm = `%${params.search}%`;
    values.push(searchTerm, searchTerm, searchTerm);
  }

  if (params.actionType) {
    conditions.push("action_type = ?");
    values.push(params.actionType);
  }

  if (params.productId !== undefined) {
    conditions.push("wc_product_id = ?");
    values.push(params.productId);
  }

  if (params.processed !== undefined) {
    conditions.push("processed = ?");
    values.push(params.processed ? 1 : 0);
  }

  if (params.hasError !== undefined) {
    if (params.hasError) {
      conditions.push("error IS NOT NULL");
    } else {
      conditions.push("error IS NULL");
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Get total count
  const countQuery = `SELECT COUNT(*) as count FROM webhook_events ${whereClause}`;
  const total = db.query<{ count: number }, (string | number)[]>(countQuery).get(...values)?.count ?? 0;

  // Get paginated results
  const query = `
    SELECT * FROM webhook_events
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  const events = db.query<WebhookEvent, (string | number)[]>(query).all(...values, limit, offset);

  return {
    events,
    total,
    limit,
    offset,
    hasMore: offset + events.length < total,
  };
}

export function getRecentWebhookEvents(limit = 10): WebhookEvent[] {
  const db = getDb();
  return db.query<WebhookEvent, [number]>(
    "SELECT * FROM webhook_events ORDER BY created_at DESC LIMIT ?"
  ).all(limit);
}

export function getWebhookEventById(eventId: number): WebhookEvent | null {
  const db = getDb();
  return db.query<WebhookEvent, [number]>(
    "SELECT * FROM webhook_events WHERE id = ?"
  ).get(eventId);
}

export function getUnprocessedWebhookEvents(): WebhookEvent[] {
  const db = getDb();
  return db.query<WebhookEvent, []>(
    "SELECT * FROM webhook_events WHERE processed = 0 AND error IS NULL ORDER BY created_at ASC"
  ).all();
}

export function getWebhookEventCount(): { total: number; processed: number; errors: number } {
  const db = getDb();

  const total = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM webhook_events"
  ).get()?.count ?? 0;

  const processed = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM webhook_events WHERE processed = 1"
  ).get()?.count ?? 0;

  const errors = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM webhook_events WHERE error IS NOT NULL"
  ).get()?.count ?? 0;

  return { total, processed, errors };
}

export function getWebhookStats(): {
  total: number;
  processed: number;
  errors: number;
  byAction: Record<string, number>;
  stockIncreases: number;
  stockDecreases: number;
} {
  const db = getDb();

  const counts = getWebhookEventCount();

  // Count by action type
  const actionCounts = db.query<{ action_type: string; count: number }, []>(
    "SELECT action_type, COUNT(*) as count FROM webhook_events WHERE action_type IS NOT NULL GROUP BY action_type"
  ).all();

  const byAction: Record<string, number> = {};
  for (const row of actionCounts) {
    byAction[row.action_type] = row.count;
  }

  // Count stock increases and decreases
  const stockIncreases = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM webhook_events WHERE stock_change > 0"
  ).get()?.count ?? 0;

  const stockDecreases = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM webhook_events WHERE stock_change < 0"
  ).get()?.count ?? 0;

  return {
    ...counts,
    byAction,
    stockIncreases,
    stockDecreases,
  };
}
