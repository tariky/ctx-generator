import type { WCProduct } from "../types";
import { upsertProduct, deleteProduct, getProductById } from "../db/products";
import { getSyncStatusByProductId, deleteSyncStatus, markSynced } from "../db/sync-status";
import { syncSingleProduct, syncVariableProduct } from "../sync/product-sync";
import { fetchWooCommerce } from "../woocommerce";
import { updateProductStock } from "../meta/client";
import { generateMetaRetailerIdFromInfo } from "../utils/retailer-id";

export async function processWebhookEvent(
  topic: string,
  productData: WCProduct
): Promise<void> {
  const [resource, event] = topic.split(".");

  if (resource !== "product") {
    console.log(`Ignoring non-product webhook: ${topic}`);
    return;
  }

  console.log(`Processing webhook: ${topic} for product ${productData.id}`);

  try {
    switch (event) {
      case "created":
        await handleProductCreated(productData);
        break;
      case "updated":
        await handleProductUpdated(productData);
        break;
      case "deleted":
        await handleProductDeleted(productData);
        break;
      case "restored":
        await handleProductRestored(productData);
        break;
      default:
        console.log(`Unknown event type: ${event}`);
    }
  } catch (error) {
    console.error(`Error processing webhook ${topic}:`, error);
    throw error;
  }
}

async function handleProductCreated(product: WCProduct): Promise<void> {
  console.log(`Handling product.created for ${product.id}`);

  // Store in SQLite
  upsertProduct(product);

  // If in stock, sync to Meta Catalog
  if (product.stock_status === "instock") {
    if (product.type === "variable" && product.variations?.length > 0) {
      await syncVariableProduct(product);
    } else {
      await syncSingleProduct(product);
    }
  }
}

async function handleProductUpdated(product: WCProduct): Promise<void> {
  // Log full product data for debugging
  console.log(`Handling product.updated for ${product.id}`);
  console.log(`Product type: ${product.type}, parent_id: ${product.parent_id}, stock_status: ${product.stock_status}`);

  // Detect if this is a variation
  const isVariation = product.type === "variation" || product.parent_id > 0;

  // Get current state from SQLite
  const currentProduct = getProductById(product.id);
  const syncStatus = getSyncStatusByProductId(product.id);

  // Update SQLite
  upsertProduct(product);

  // Handle variable products (parent with variations)
  if (product.type === "variable" && product.variations?.length > 0) {
    console.log(`Processing variable product ${product.id} with ${product.variations.length} variations`);
    await syncVariableProduct(product);
    return;
  }

  // Handle variation updates
  if (isVariation) {
    const parentId = product.parent_id;
    console.log(`Processing variation ${product.id} of parent ${parentId}`);

    if (parentId > 0) {
      // Fetch parent product for proper mapping
      try {
        const parent = await fetchWooCommerce(`/products/${parentId}`) as WCProduct;
        product.type = "variation";

        // Generate correct Meta retailer ID using centralized function
        const metaRetailerId = generateMetaRetailerIdFromInfo(product.id, "variation", parentId);
        console.log(`Syncing variation to Meta with retailer_id: ${metaRetailerId}`);

        await syncSingleProduct(product, parent);
      } catch (error) {
        console.error(`Error fetching parent product ${parentId}:`, error);
        // Still try to sync with what we have
        await syncSingleProduct(product);
      }
    } else {
      console.warn(`Variation ${product.id} has no parent_id, skipping`);
    }
    return;
  }

  // Handle simple product
  console.log(`Processing simple product ${product.id}`);
  const isNowInStock = product.stock_status === "instock";
  const existsInMeta = syncStatus?.meta_product_exists === 1;

  if (isNowInStock && !existsInMeta) {
    // Create new product in Meta
    console.log(`Creating simple product ${product.id} in Meta`);
    await syncSingleProduct(product);
  } else if (isNowInStock && existsInMeta) {
    // Update existing product
    console.log(`Updating simple product ${product.id} in Meta`);
    await syncSingleProduct(product);
  } else if (!isNowInStock && existsInMeta) {
    // Update to out of stock (don't delete, just mark unavailable)
    const metaRetailerId = generateMetaRetailerIdFromInfo(product.id, product.type, product.parent_id);
    console.log(`Marking product ${metaRetailerId} as out of stock in Meta`);
    await updateProductStock(metaRetailerId, "out of stock", 0);
    markSynced(metaRetailerId, "out of stock", 0);
  } else {
    console.log(`No action needed for product ${product.id} (inStock: ${isNowInStock}, existsInMeta: ${existsInMeta})`);
  }
}

async function handleProductDeleted(product: WCProduct): Promise<void> {
  console.log(`Handling product.deleted for ${product.id}`);
  console.log(`Product type: ${product.type}, parent_id: ${product.parent_id}`);

  // Mark product in Meta as out of stock
  const syncStatus = getSyncStatusByProductId(product.id);
  if (syncStatus?.meta_product_exists) {
    const metaRetailerId = generateMetaRetailerIdFromInfo(product.id, product.type, product.parent_id);
    console.log(`Marking deleted product ${metaRetailerId} as out of stock in Meta`);
    await updateProductStock(metaRetailerId, "out of stock", 0);
  }

  // Remove from SQLite
  deleteProduct(product.id);
  deleteSyncStatus(product.id);
}

async function handleProductRestored(product: WCProduct): Promise<void> {
  console.log(`Handling product.restored for ${product.id}`);
  // Treat as create
  await handleProductCreated(product);
}
