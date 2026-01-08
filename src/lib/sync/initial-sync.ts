import { fetchAllProducts, fetchWooCommerce, mapToMetaProduct } from "../woocommerce";
import { bulkUpsertProducts, upsertProduct, getProductById } from "../db/products";
import { upsertSyncStatus, markSynced } from "../db/sync-status";
import { batchSyncProducts, createBatchItem } from "../meta/catalog";
import { fetchCatalogState, batchUpsertProducts } from "../meta/client";
import type { WCProduct, MetaProduct } from "../types";
import type { MetaBatchItem } from "../meta/types";

export interface SyncReport {
  startedAt: Date;
  completedAt?: Date;
  totalProducts: number;
  inStock: number;
  synced: number;
  created: number;
  updated: number;
  errors: number;
  skipped: number;
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

export async function performInitialSync(): Promise<SyncReport> {
  const report: SyncReport = {
    startedAt: new Date(),
    totalProducts: 0,
    inStock: 0,
    synced: 0,
    created: 0,
    updated: 0,
    errors: 0,
    skipped: 0,
  };

  try {
    // Step 1: Fetch only in-stock products from WooCommerce
    console.log("Fetching in-stock products from WooCommerce...");
    const wcProducts = await fetchAllProducts("/products", { stock_status: "instock" });
    report.totalProducts = wcProducts.length;
    console.log(`Fetched ${wcProducts.length} in-stock products from WooCommerce`);

    // Step 2: Store all products in SQLite
    console.log("Storing products in SQLite...");
    bulkUpsertProducts(wcProducts);
    console.log("Products stored in SQLite");

    // Step 3: Fetch current Meta Catalog state
    console.log("Fetching Meta Catalog state...");
    const catalogState = await fetchCatalogState();
    console.log(`Found ${catalogState.size} products in Meta Catalog`);

    // Step 4: Process products and their variations
    const batchItems: MetaBatchItem[] = [];
    const productIdMap = new Map<string, number>();

    for (const product of wcProducts) {
      if (product.type === "variable" && product.variations.length > 0) {
        // Fetch all variations for variable products
        console.log(`Fetching variations for product ${product.id}...`);
        const variations = await fetchWooCommerce(`/products/${product.id}/variations`, {
          per_page: "100",
        }) as WCProduct[];

        // Store and process variations
        for (const variation of variations) {
          variation.parent_id = product.id;
          variation.type = "variation";
          upsertProduct(variation, product);

          if (variation.stock_status === "instock") {
            report.inStock++;
            const metaProduct = mapToMetaProduct(variation, product);
            const metaRetailerId = generateMetaRetailerId(variation, product);
            const exists = catalogState.has(metaRetailerId);

            // Create sync status entry
            upsertSyncStatus(variation.id, metaRetailerId, {
              sync_status: "pending",
              meta_product_exists: exists ? 1 : 0,
            });

            batchItems.push(createBatchItem(metaProduct, exists));
            productIdMap.set(metaRetailerId, variation.id);
          }
        }

        // Also add main variable product if in stock
        if (product.stock_status === "instock") {
          report.inStock++;
          const metaProduct = mapToMetaProduct(product);
          const metaRetailerId = generateMetaRetailerId(product);
          const exists = catalogState.has(metaRetailerId);

          upsertSyncStatus(product.id, metaRetailerId, {
            sync_status: "pending",
            meta_product_exists: exists ? 1 : 0,
          });

          batchItems.push(createBatchItem(metaProduct, exists));
          productIdMap.set(metaRetailerId, product.id);
        }
      } else if (product.stock_status === "instock") {
        // Simple product
        report.inStock++;
        const metaProduct = mapToMetaProduct(product);
        const metaRetailerId = generateMetaRetailerId(product);
        const exists = catalogState.has(metaRetailerId);

        upsertSyncStatus(product.id, metaRetailerId, {
          sync_status: "pending",
          meta_product_exists: exists ? 1 : 0,
        });

        batchItems.push(createBatchItem(metaProduct, exists));
        productIdMap.set(metaRetailerId, product.id);
      }
    }

    console.log(`Prepared ${batchItems.length} items for Meta Catalog sync`);

    // Step 5: Execute batch sync in chunks (Meta limit: ~1000 items per batch)
    const BATCH_SIZE = 1000;
    for (let i = 0; i < batchItems.length; i += BATCH_SIZE) {
      const chunk = batchItems.slice(i, i + BATCH_SIZE);
      console.log(`Syncing batch ${Math.floor(i / BATCH_SIZE) + 1} (${chunk.length} items)...`);

      try {
        const result = await batchUpsertProducts(chunk);

        if (result.error) {
          console.error("Batch sync error:", result.error);
          report.errors += chunk.length;
          continue;
        }

        // Process validation results
        for (const item of chunk) {
          const validationError = result.validation_status?.find(
            (v) => v.retailer_id === item.retailer_id && v.errors?.length
          );

          if (validationError?.errors?.length) {
            report.errors++;
            const productId = productIdMap.get(item.retailer_id);
            if (productId) {
              upsertSyncStatus(productId, item.retailer_id, {
                sync_status: "error",
                last_error: validationError.errors.map((e) => e.message).join(", "),
              });
            }
          } else {
            if (item.method === "CREATE") {
              report.created++;
            } else {
              report.updated++;
            }
            report.synced++;

            const productId = productIdMap.get(item.retailer_id);
            if (productId) {
              markSynced(
                item.retailer_id,
                item.data.availability || "in stock",
                item.data.inventory ?? null
              );
            }
          }
        }
      } catch (error) {
        console.error("Batch sync error:", error);
        report.errors += chunk.length;
      }
    }

    report.completedAt = new Date();
    console.log("Initial sync completed:", report);
    return report;
  } catch (error) {
    console.error("Initial sync error:", error);
    report.completedAt = new Date();
    throw error;
  }
}
