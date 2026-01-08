import { getDb } from "../db/index";

export interface WebhookEvent {
  id: number;
  topic: string;
  wc_product_id: number;
  payload: string;
  signature: string | null;
  processed: number;
  processed_at: string | null;
  error: string | null;
  created_at: string;
}

export function logWebhookEvent(
  topic: string,
  wcProductId: number,
  payload: string,
  signature: string | null
): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO webhook_events (topic, wc_product_id, payload, signature)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(topic, wcProductId, payload, signature);
  return Number(result.lastInsertRowid);
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

export function getRecentWebhookEvents(limit = 10): WebhookEvent[] {
  const db = getDb();
  return db.query<WebhookEvent, [number]>(
    "SELECT * FROM webhook_events ORDER BY created_at DESC LIMIT ?"
  ).all(limit);
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
