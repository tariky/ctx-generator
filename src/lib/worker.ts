import { parentPort, workerData } from "worker_threads";
import { mapToMetaProduct } from "./woocommerce";
import type { WCProduct, MetaProduct } from "./types";

if (!parentPort) {
  throw new Error("This file must be run as a worker");
}

const { products, WC_CURRENCY, WC_BRAND, WC_API_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET } = workerData;

// We need to inject env vars if mapToMetaProduct depends on them (it does implicitly via global imports in original file)
// But since we moved mapToMetaProduct to export, it still relies on module-level vars in woocommerce.ts
// which might not be initialized in worker context same way. 

// Actually, mapToMetaProduct in woocommerce.ts uses module-level vars: WC_CURRENCY, WC_BRAND.
// We should refactor mapToMetaProduct to accept config or ensure vars are set.

// For now, let's just process the items.
// Note: mapToMetaProduct assumes WC_CURRENCY and WC_BRAND are available in its scope.
// Since we import it from woocommerce.ts, that module is evaluated.
// However, process.env might not be populated in worker the same way if not passed?
// Bun workers inherit env, so it should be fine.

// BUT, we have one issue: fetchWooCommerce is also used inside woocommerce.ts for variations.
// If we are just processing "already fetched" products, we don't need to fetch more?
// Wait, the logic in generateProductFeed does fetch variations recursively for variable products.
// If we parallelize, we should parallelize the *fetching and processing* of chunks of products.

async function processChunk() {
  const feedItems: MetaProduct[] = [];
  
  // We need to redefine fetchWooCommerce locally or ensure the imported one works.
  // The imported one relies on process.env.
  
  // Let's implement a local fetch helper that uses passed credentials if needed,
  // or rely on the imported one if envs are correct.
  
  // Re-importing fetchWooCommerce from woocommerce.ts
  const { fetchWooCommerce } = await import("./woocommerce");

  for (const product of products as WCProduct[]) {
    if (product.type === "variable" && product.variations.length > 0) {
      try {
        // Fetch variations
        const variations: WCProduct[] = await fetchWooCommerce(`/products/${product.id}/variations`, { per_page: "100" });
        
        let totalInventory = 0;
        let hasInStock = false;

        for (const variation of variations) {
          if (variation.stock_quantity) {
            totalInventory += variation.stock_quantity;
          }
          if (variation.stock_status === "instock") {
            hasInStock = true;
          }
        }

        const item = mapToMetaProduct(product);
        item.inventory = totalInventory > 0 ? totalInventory : undefined;
        
        if (hasInStock || product.stock_status === "instock") {
          item.availability = "in stock";
          feedItems.push(item);
        }
        
        for (const variation of variations) {
          const variantItem = mapToMetaProduct(variation, product);
          if (variantItem.availability === "in stock") {
            feedItems.push(variantItem);
          }
        }
      } catch (e) {
        console.error(`Error processing variable product ${product.id}:`, e);
      }
    } else {
      const item = mapToMetaProduct(product);
      if (item.availability === "in stock") {
        feedItems.push(item);
      }
    }
  }
  
  parentPort?.postMessage(feedItems);
}

processChunk();

