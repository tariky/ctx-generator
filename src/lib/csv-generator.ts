import { stringify } from "csv-stringify/sync";
import { Base64 } from "js-base64";
import { getDb } from "./db/index";
import { fetchWooCommerce, fetchAllProducts, mapToMetaProduct } from "./woocommerce";
import type { WCProduct, MetaProduct } from "./types";

const WC_BRAND = process.env.WC_BRAND || "Lunatik";
const WC_CURRENCY = process.env.WC_CURRENCY || "BAM";

interface DbProductRow {
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
}

// Store variations in a separate table for fast access
function initVariationsTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_variations (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER NOT NULL,
      name TEXT,
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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_variations_parent_id ON product_variations(parent_id);
    CREATE INDEX IF NOT EXISTS idx_variations_stock_status ON product_variations(stock_status);
  `);
}

function upsertVariation(variation: WCProduct, parentId: number): void {
  const db = getDb();
  const imageUrl = variation.images?.[0]?.src || null;

  db.run(`
    INSERT INTO product_variations (
      id, parent_id, name, sku, permalink, price, regular_price, sale_price,
      stock_status, stock_quantity, description, image_url, attributes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      parent_id = excluded.parent_id,
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
      updated_at = CURRENT_TIMESTAMP
  `, [
    variation.id,
    parentId,
    variation.name || null,
    variation.sku || null,
    variation.permalink || null,
    variation.price || null,
    variation.regular_price || null,
    variation.sale_price || null,
    variation.stock_status,
    variation.stock_quantity,
    variation.description || null,
    imageUrl,
    variation.attributes ? JSON.stringify(variation.attributes) : null,
  ]);
}

// Fetch and cache all variations in parallel (only in-stock)
async function refreshVariationsCache(): Promise<void> {
  console.log("Refreshing variations cache...");
  initVariationsTable();

  const db = getDb();

  // Get all variable products that are in stock
  const variableProducts = db.query<{ id: number; variations: string }, []>(`
    SELECT id, variations FROM products WHERE type = 'variable' AND variations IS NOT NULL AND stock_status = 'instock'
  `).all();

  console.log(`Found ${variableProducts.length} variable products`);

  // Fetch all variations in parallel (batch of 10 at a time to avoid overloading)
  const BATCH_SIZE = 10;
  for (let i = 0; i < variableProducts.length; i += BATCH_SIZE) {
    const batch = variableProducts.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (product) => {
      try {
        const variations: WCProduct[] = await fetchWooCommerce(
          `/products/${product.id}/variations`,
          { per_page: "100" }
        );
        return { parentId: product.id, variations };
      } catch (e) {
        console.error(`Error fetching variations for product ${product.id}:`, e);
        return { parentId: product.id, variations: [] };
      }
    });

    const results = await Promise.all(promises);

    // Store in database
    const transaction = db.transaction(() => {
      for (const { parentId, variations } of results) {
        for (const variation of variations) {
          upsertVariation(variation, parentId);
        }
      }
    });
    transaction();

    console.log(`Cached variations for batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(variableProducts.length / BATCH_SIZE)}`);
  }

  console.log("Variations cache refreshed");
}

// Convert DB row to WCProduct-like object
function dbRowToProduct(row: DbProductRow): WCProduct {
  return {
    id: row.id,
    parent_id: row.parent_id,
    type: row.type,
    name: row.name,
    sku: row.sku || "",
    permalink: row.permalink || "",
    price: row.price || "",
    regular_price: row.regular_price || "",
    sale_price: row.sale_price || "",
    stock_status: row.stock_status,
    stock_quantity: row.stock_quantity,
    description: row.description || "",
    short_description: "",
    slug: "",
    status: "publish",
    date_on_sale_from: null,
    date_on_sale_to: null,
    images: row.image_url ? [{ id: 0, src: row.image_url }] : [],
    attributes: row.attributes ? JSON.parse(row.attributes) : [],
    variations: row.variations ? JSON.parse(row.variations) : [],
    categories: [],
  };
}

// Fast CSV generation from cache
export async function generateFastProductFeed(
  style: "standard" | "christmas" = "standard"
): Promise<string> {
  console.log(`Fast generating ${style} feed from cache...`);
  const startTime = Date.now();

  initVariationsTable();
  const db = getDb();

  // Check if we have cached products
  const productCount = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM products"
  ).get()?.count || 0;

  if (productCount === 0) {
    throw new Error("No products in cache. Run initial sync first or use slow generation.");
  }

  const feedItems: MetaProduct[] = [];

  // Get all in-stock simple products
  const simpleProducts = db.query<DbProductRow, []>(`
    SELECT * FROM products
    WHERE type != 'variable' AND stock_status = 'instock'
  `).all();

  console.log(`Processing ${simpleProducts.length} simple products...`);

  for (const row of simpleProducts) {
    const product = dbRowToProduct(row);
    const item = mapToMetaProduct(product, undefined, style);
    feedItems.push(item);
  }

  // Get all in-stock variable products with their variations
  const variableProducts = db.query<DbProductRow, []>(`
    SELECT * FROM products WHERE type = 'variable' AND stock_status = 'instock'
  `).all();

  console.log(`Processing ${variableProducts.length} variable products...`);

  for (const row of variableProducts) {
    const product = dbRowToProduct(row);

    // Get variations from cache
    const variations = db.query<DbProductRow, [number]>(`
      SELECT * FROM product_variations WHERE parent_id = ?
    `).all(row.id);

    let totalInventory = 0;
    let hasInStock = false;

    for (const varRow of variations) {
      if (varRow.stock_quantity) {
        totalInventory += varRow.stock_quantity;
      }
      if (varRow.stock_status === "instock") {
        hasInStock = true;
      }
    }

    // Add main product if has in-stock variations
    if (hasInStock || product.stock_status === "instock") {
      const item = mapToMetaProduct(product, undefined, style);
      item.inventory = totalInventory > 0 ? totalInventory : undefined;
      item.availability = "in stock";
      feedItems.push(item);
    }

    // Add in-stock variations
    for (const varRow of variations) {
      if (varRow.stock_status === "instock") {
        const variation = dbRowToProduct(varRow);
        variation.parent_id = row.id;
        const variantItem = mapToMetaProduct(variation, product, style);
        feedItems.push(variantItem);
      }
    }
  }

  // Generate CSV
  const columns = [
    "id", "title", "description", "rich_text_description", "availability",
    "condition", "price", "link", "image_link", "brand",
    "image[0].url", "image[0].tag[0]", "image[1].url", "image[1].tag[0]",
    "image[2].url", "image[2].tag[0]", "image[2].tag[1]",
    "age_group", "color", "gender", "item_group_id", "google_product_category",
    "product_type", "sale_price", "sale_price_effective_date", "size", "status", "inventory",
  ];

  const csv = stringify(feedItems, {
    header: true,
    columns,
    quoted: true,
  });

  const elapsed = Date.now() - startTime;
  console.log(`Fast feed generated in ${elapsed}ms with ${feedItems.length} items`);

  return csv;
}

// Refresh cache from WooCommerce and generate feed
export async function refreshAndGenerateFeed(
  style: "standard" | "christmas" = "standard"
): Promise<string> {
  console.log("Refreshing products from WooCommerce (in-stock only)...");
  const startTime = Date.now();

  initVariationsTable();
  const db = getDb();

  // Fetch only in-stock products from WooCommerce
  const products = await fetchAllProducts("/products", { stock_status: "instock" });
  console.log(`Fetched ${products.length} in-stock products from WooCommerce`);

  // Store products in database
  const insertProduct = db.prepare(`
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

  const transaction = db.transaction(() => {
    for (const product of products) {
      const metaRetailerId = product.type === "variable"
        ? `wc_${product.id}_main`
        : `wc_${product.id}`;

      insertProduct.run(
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
        product.images?.[0]?.src || null,
        product.attributes ? JSON.stringify(product.attributes) : null,
        product.variations?.length ? JSON.stringify(product.variations) : null
      );
    }
  });
  transaction();

  console.log("Products cached, now fetching variations...");

  // Refresh variations cache in parallel
  await refreshVariationsCache();

  // Generate feed from cache
  const csv = await generateFastProductFeed(style);

  const elapsed = Date.now() - startTime;
  console.log(`Total refresh + generation time: ${elapsed}ms`);

  return csv;
}

// Generate both feeds quickly
export async function generateBothFastFeeds(): Promise<{ standard: string; christmas: string }> {
  const [standard, christmas] = await Promise.all([
    generateFastProductFeed("standard"),
    generateFastProductFeed("christmas"),
  ]);
  return { standard, christmas };
}
