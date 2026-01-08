import { mapToMetaProduct, fetchWooCommerce } from "../woocommerce";
import { upsertProduct, getProductById } from "../db/products";
import { getSyncStatusByProductId, upsertSyncStatus, markSynced, markError } from "../db/sync-status";
import { syncProductToMeta, createBatchItem } from "../meta/catalog";
import { getProductByRetailerId, batchUpsertProducts } from "../meta/client";
import { generateMetaRetailerId } from "../utils/retailer-id";
import type { WCProduct } from "../types";

function mapAvailability(stockStatus: string): "in stock" | "out of stock" | "preorder" {
  switch (stockStatus) {
    case "instock":
      return "in stock";
    case "onbackorder":
      return "preorder";
    default:
      return "out of stock";
  }
}

export function hasStockChanged(
  product: WCProduct,
  syncStatus: { last_availability: string | null; last_inventory: number | null } | null
): boolean {
  if (!syncStatus) return true;

  const newAvailability = mapAvailability(product.stock_status);
  const newInventory = product.stock_quantity ?? 0;

  return (
    syncStatus.last_availability !== newAvailability ||
    syncStatus.last_inventory !== newInventory
  );
}

export async function syncSingleProduct(product: WCProduct, parent?: WCProduct): Promise<{
  success: boolean;
  action: "created" | "updated" | "skipped" | "deleted";
  error?: string;
}> {
  try {
    const metaRetailerId = generateMetaRetailerId(product, parent);

    // Store/update product in SQLite
    upsertProduct(product, parent);

    // Get current sync status
    const syncStatus = getSyncStatusByProductId(product.id);

    // If out of stock, mark as unavailable in Meta (don't delete)
    if (product.stock_status !== "instock") {
      if (syncStatus?.meta_product_exists) {
        // Update to out of stock
        const metaProduct = mapToMetaProduct(product, parent);
        metaProduct.availability = "out of stock";
        metaProduct.inventory = 0;

        const item = createBatchItem(metaProduct, true);
        const result = await batchUpsertProducts([item]);

        if (result.error) {
          markError(metaRetailerId, result.error.message);
          return { success: false, action: "skipped", error: result.error.message };
        }

        markSynced(metaRetailerId, "out of stock", 0);
        return { success: true, action: "updated" };
      }

      // Product not in Meta and out of stock - skip
      return { success: true, action: "skipped" };
    }

    // Product is in stock - check if we need to sync
    if (!hasStockChanged(product, syncStatus)) {
      return { success: true, action: "skipped" };
    }

    // Sync to Meta Catalog
    const metaProduct = mapToMetaProduct(product, parent);
    const existsInMeta = await getProductByRetailerId(metaRetailerId);

    // Create or update sync status
    upsertSyncStatus(product.id, metaRetailerId, {
      sync_status: "pending",
      meta_product_exists: existsInMeta ? 1 : 0,
    });

    const item = createBatchItem(metaProduct, !!existsInMeta);
    const result = await batchUpsertProducts([item]);

    if (result.error) {
      markError(metaRetailerId, result.error.message);
      return { success: false, action: "skipped", error: result.error.message };
    }

    const validationError = result.validation_status?.find(
      (v) => v.retailer_id === metaRetailerId && v.errors?.length
    );

    if (validationError?.errors?.length) {
      const errorMsg = validationError.errors.map((e) => e.message).join(", ");
      markError(metaRetailerId, errorMsg);
      return { success: false, action: "skipped", error: errorMsg };
    }

    markSynced(metaRetailerId, metaProduct.availability, metaProduct.inventory ?? null);

    return {
      success: true,
      action: existsInMeta ? "updated" : "created",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, action: "skipped", error: errorMsg };
  }
}

export async function syncVariableProduct(product: WCProduct): Promise<{
  success: boolean;
  synced: number;
  errors: number;
}> {
  const result = { success: true, synced: 0, errors: 0 };

  try {
    // Fetch all variations
    const variations = await fetchWooCommerce(`/products/${product.id}/variations`, {
      per_page: "100",
    }) as WCProduct[];

    // Sync each variation
    for (const variation of variations) {
      variation.parent_id = product.id;
      variation.type = "variation";

      const syncResult = await syncSingleProduct(variation, product);
      if (syncResult.success && syncResult.action !== "skipped") {
        result.synced++;
      } else if (!syncResult.success) {
        result.errors++;
      }
    }

    // Also sync main variable product
    const mainResult = await syncSingleProduct(product);
    if (mainResult.success && mainResult.action !== "skipped") {
      result.synced++;
    } else if (!mainResult.success) {
      result.errors++;
    }

    result.success = result.errors === 0;
    return result;
  } catch (error) {
    console.error(`Error syncing variable product ${product.id}:`, error);
    result.success = false;
    return result;
  }
}
