import type { WCProduct } from "../types";
import { upsertProduct, deleteProduct, getProductById } from "../db/products";
import { getSyncStatusByProductId, deleteSyncStatus, markSynced } from "../db/sync-status";
import { syncSingleProduct, syncVariableProduct } from "../sync/product-sync";
import { fetchWooCommerce } from "../woocommerce";
import { updateProductStock } from "../meta/client";

function generateMetaRetailerId(productId: number, type?: string): string {
  if (type === "variable") {
    return `wc_${productId}_main`;
  }
  return `wc_${productId}`;
}

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
  console.log(`Handling product.updated for ${product.id}`);

  // Get current state from SQLite
  const currentProduct = getProductById(product.id);
  const syncStatus = getSyncStatusByProductId(product.id);

  // Update SQLite
  upsertProduct(product);

  // Handle variable products
  if (product.type === "variable" && product.variations?.length > 0) {
    await syncVariableProduct(product);
    return;
  }

  // Handle variation updates
  if (product.parent_id > 0) {
    // Fetch parent product for proper mapping
    try {
      const parent = await fetchWooCommerce(`/products/${product.parent_id}`) as WCProduct;
      product.type = "variation";
      await syncSingleProduct(product, parent);
    } catch (error) {
      console.error(`Error fetching parent product ${product.parent_id}:`, error);
      await syncSingleProduct(product);
    }
    return;
  }

  // Handle simple product
  const wasInStock = currentProduct?.stock_status === "instock";
  const isNowInStock = product.stock_status === "instock";
  const existsInMeta = syncStatus?.meta_product_exists === 1;

  if (isNowInStock && !existsInMeta) {
    // Create new product in Meta
    await syncSingleProduct(product);
  } else if (isNowInStock && existsInMeta) {
    // Update existing product
    await syncSingleProduct(product);
  } else if (!isNowInStock && existsInMeta) {
    // Update to out of stock (don't delete, just mark unavailable)
    const metaRetailerId = generateMetaRetailerId(product.id, product.type);
    await updateProductStock(metaRetailerId, "out of stock", 0);
    markSynced(metaRetailerId, "out of stock", 0);
  }
}

async function handleProductDeleted(product: WCProduct): Promise<void> {
  console.log(`Handling product.deleted for ${product.id}`);

  // Mark product in Meta as out of stock
  const syncStatus = getSyncStatusByProductId(product.id);
  if (syncStatus?.meta_product_exists) {
    const metaRetailerId = generateMetaRetailerId(product.id, product.type);
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
