import type { MetaProduct } from "../types";
import type { MetaBatchItem, MetaBatchResponse, MetaCatalogProduct } from "./types";
import { batchUpsertProducts, fetchCatalogState, getProductByRetailerId } from "./client";
import { markSynced, markError, upsertSyncStatus } from "../db/sync-status";

const WC_CURRENCY = process.env.WC_CURRENCY || "BAM";

export interface SyncResult {
  success: boolean;
  retailerId: string;
  action: "created" | "updated" | "skipped";
  error?: string;
}

export interface BatchSyncResult {
  total: number;
  created: number;
  updated: number;
  errors: number;
  results: SyncResult[];
}

function mapAvailability(
  stockStatus: string
): "in stock" | "out of stock" | "preorder" {
  switch (stockStatus) {
    case "instock":
      return "in stock";
    case "onbackorder":
      return "preorder";
    default:
      return "out of stock";
  }
}

export function createBatchItem(
  product: MetaProduct,
  existsInCatalog: boolean
): MetaBatchItem {
  const method = existsInCatalog ? "UPDATE" : "CREATE";

  const data: MetaBatchItem["data"] = {
    availability: product.availability,
    inventory: product.inventory,
  };

  if (!existsInCatalog) {
    data.name = product.title;
    data.description = product.description;
    data.image_link = product.image_link;
    data.url = product.link;
    data.price = product.price;
    data.brand = product.brand;
    data.condition = product.condition;
    data.currency = WC_CURRENCY;
  }

  return {
    method,
    retailer_id: product.id,
    data,
  };
}

export async function syncProductToMeta(
  product: MetaProduct,
  productId: number
): Promise<SyncResult> {
  try {
    const existingProduct = await getProductByRetailerId(product.id);
    const existsInCatalog = !!existingProduct;

    const batchItem = createBatchItem(product, existsInCatalog);
    const result = await batchUpsertProducts([batchItem]);

    if (result.error) {
      const errorMsg = result.error.message;
      markError(product.id, errorMsg);
      return {
        success: false,
        retailerId: product.id,
        action: "skipped",
        error: errorMsg,
      };
    }

    const validationErrors = result.validation_status?.find(
      (v) => v.retailer_id === product.id && v.errors?.length
    );

    if (validationErrors?.errors?.length) {
      const errorMsg = validationErrors.errors.map((e) => e.message).join(", ");
      markError(product.id, errorMsg);
      return {
        success: false,
        retailerId: product.id,
        action: "skipped",
        error: errorMsg,
      };
    }

    markSynced(product.id, product.availability, product.inventory ?? null);

    return {
      success: true,
      retailerId: product.id,
      action: existsInCatalog ? "updated" : "created",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    markError(product.id, errorMsg);
    return {
      success: false,
      retailerId: product.id,
      action: "skipped",
      error: errorMsg,
    };
  }
}

export async function batchSyncProducts(
  products: MetaProduct[],
  productIdMap: Map<string, number>
): Promise<BatchSyncResult> {
  const result: BatchSyncResult = {
    total: products.length,
    created: 0,
    updated: 0,
    errors: 0,
    results: [],
  };

  if (products.length === 0) {
    return result;
  }

  const catalogState = await fetchCatalogState();

  const BATCH_SIZE = 1000;
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const chunk = products.slice(i, i + BATCH_SIZE);

    const batchItems: MetaBatchItem[] = [];
    const productMap = new Map<string, { product: MetaProduct; exists: boolean }>();

    for (const product of chunk) {
      const exists = catalogState.has(product.id);
      batchItems.push(createBatchItem(product, exists));
      productMap.set(product.id, { product, exists });
    }

    try {
      const batchResult = await batchUpsertProducts(batchItems);

      if (batchResult.error) {
        for (const item of batchItems) {
          result.errors++;
          markError(item.retailer_id, batchResult.error.message);
          result.results.push({
            success: false,
            retailerId: item.retailer_id,
            action: "skipped",
            error: batchResult.error.message,
          });
        }
        continue;
      }

      for (const item of batchItems) {
        const info = productMap.get(item.retailer_id);
        if (!info) continue;

        const validationError = batchResult.validation_status?.find(
          (v) => v.retailer_id === item.retailer_id && v.errors?.length
        );

        if (validationError?.errors?.length) {
          result.errors++;
          const errorMsg = validationError.errors.map((e) => e.message).join(", ");
          markError(item.retailer_id, errorMsg);
          result.results.push({
            success: false,
            retailerId: item.retailer_id,
            action: "skipped",
            error: errorMsg,
          });
        } else {
          if (info.exists) {
            result.updated++;
          } else {
            result.created++;
          }
          markSynced(
            item.retailer_id,
            info.product.availability,
            info.product.inventory ?? null
          );
          result.results.push({
            success: true,
            retailerId: item.retailer_id,
            action: info.exists ? "updated" : "created",
          });
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      for (const item of batchItems) {
        result.errors++;
        markError(item.retailer_id, errorMsg);
        result.results.push({
          success: false,
          retailerId: item.retailer_id,
          action: "skipped",
          error: errorMsg,
        });
      }
    }
  }

  return result;
}
