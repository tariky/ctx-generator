import type { WCProduct } from "../types";

/**
 * Centralized function to generate Meta retailer IDs.
 * This ensures consistent ID format across all sync and webhook operations.
 *
 * ID Format:
 * - Simple products: wc_{product_id}
 * - Variable products (parent): wc_{product_id}_main
 * - Variations: wc_{variation_id}
 */

export function generateMetaRetailerId(
  product: WCProduct,
  parent?: WCProduct
): string {
  // Case 1: This is a variation (has parent_id or parent object passed)
  if (product.parent_id > 0 || parent) {
    return `wc_${product.id}`;
  }

  // Case 2: This is a variable product (parent of variations)
  if (product.type === "variable") {
    return `wc_${product.id}_main`;
  }

  // Case 3: Simple product
  return `wc_${product.id}`;
}

/**
 * Generate Meta retailer ID from basic product info (used in webhooks where we only have partial data)
 */
export function generateMetaRetailerIdFromInfo(
  productId: number,
  type?: string,
  parentId?: number
): string {
  // Case 1: This is a variation
  if (type === "variation" || (parentId && parentId > 0)) {
    return `wc_${productId}`;
  }

  // Case 2: This is a variable product
  if (type === "variable") {
    return `wc_${productId}_main`;
  }

  // Case 3: Simple product
  return `wc_${productId}`;
}

/**
 * Generate item_group_id for grouping variants together in Meta
 */
export function generateItemGroupId(
  product: WCProduct,
  parent?: WCProduct
): string | undefined {
  // Variations use parent ID as group
  if (parent) {
    return `wc_${parent.id}`;
  }

  // Variable products use their own ID as group (different from their retailer_id which has _main)
  if (product.type === "variable") {
    return `wc_${product.id}`;
  }

  // Simple products don't have a group
  return undefined;
}
