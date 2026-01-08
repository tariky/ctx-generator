import { getDb } from "./index";
import type { WCProduct } from "../types";

export interface DbProduct {
  id: number;
  parent_id: number;
  type: string;
  meta_retailer_id: string;
  name: string;
  sku: string | null;
  permalink: string | null;
  price: string | null;
  regular_price: string | null;
  sale_price: string | null;
  stock_status: string;
  stock_quantity: number | null;
  description: string | null;
  image_url: string | null;
  attributes: string | null;
  variations: string | null;
  created_at: string;
  updated_at: string;
}

function generateMetaRetailerId(product: WCProduct, parent?: WCProduct): string {
  if (product.parent_id > 0) {
    return `wc_${product.id}`;
  }
  if (product.type === "variable") {
    return `wc_${product.id}_main`;
  }
  return `wc_${product.id}`;
}

export function upsertProduct(product: WCProduct, parent?: WCProduct): void {
  const db = getDb();
  const metaRetailerId = generateMetaRetailerId(product, parent);
  const imageUrl = product.images?.[0]?.src || null;

  const stmt = db.prepare(`
    INSERT INTO products (
      id, parent_id, type, meta_retailer_id, name, sku, permalink, price,
      regular_price, sale_price, stock_status, stock_quantity, description,
      image_url, attributes, variations, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      parent_id = excluded.parent_id,
      type = excluded.type,
      meta_retailer_id = excluded.meta_retailer_id,
      name = excluded.name,
      sku = excluded.sku,
      permalink = excluded.permalink,
      price = excluded.price,
      regular_price = excluded.regular_price,
      sale_price = excluded.sale_price,
      stock_status = excluded.stock_status,
      stock_quantity = excluded.stock_quantity,
      description = excluded.description,
      image_url = excluded.image_url,
      attributes = excluded.attributes,
      variations = excluded.variations,
      updated_at = CURRENT_TIMESTAMP
  `);

  stmt.run(
    product.id,
    product.parent_id || 0,
    product.type || "simple",
    metaRetailerId,
    product.name,
    product.sku || null,
    product.permalink || null,
    product.price || null,
    product.regular_price || null,
    product.sale_price || null,
    product.stock_status,
    product.stock_quantity,
    product.description || null,
    imageUrl,
    product.attributes ? JSON.stringify(product.attributes) : null,
    product.variations?.length ? JSON.stringify(product.variations) : null
  );
}

export function bulkUpsertProducts(products: WCProduct[]): void {
  const db = getDb();
  const transaction = db.transaction(() => {
    for (const product of products) {
      upsertProduct(product);
    }
  });
  transaction();
}

export function getProductById(id: number): DbProduct | null {
  const db = getDb();
  return db.query<DbProduct, [number]>("SELECT * FROM products WHERE id = ?").get(id);
}

export function getProductByMetaRetailerId(metaRetailerId: string): DbProduct | null {
  const db = getDb();
  return db.query<DbProduct, [string]>(
    "SELECT * FROM products WHERE meta_retailer_id = ?"
  ).get(metaRetailerId);
}

export function getAllProducts(limit = 100, offset = 0): DbProduct[] {
  const db = getDb();
  return db.query<DbProduct, [number, number]>(
    "SELECT * FROM products ORDER BY updated_at DESC LIMIT ? OFFSET ?"
  ).all(limit, offset);
}

export function getInStockProducts(): DbProduct[] {
  const db = getDb();
  return db.query<DbProduct, []>(
    "SELECT * FROM products WHERE stock_status = 'instock'"
  ).all();
}

export function deleteProduct(id: number): void {
  const db = getDb();
  db.run("DELETE FROM products WHERE id = ?", [id]);
}

export function getProductCount(): number {
  const db = getDb();
  const result = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM products"
  ).get();
  return result?.count ?? 0;
}

export function getInStockCount(): number {
  const db = getDb();
  const result = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM products WHERE stock_status = 'instock'"
  ).get();
  return result?.count ?? 0;
}
