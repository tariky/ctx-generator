import type {
  MetaApiResponse,
  MetaCatalogProduct,
  MetaBatchItem,
  MetaBatchResponse,
} from "./types";

const META_BASE_URL = "https://graph.facebook.com/v21.0";
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_CATALOG_ID = process.env.META_CATALOG_ID;

function validateConfig(): void {
  if (!META_ACCESS_TOKEN) {
    throw new Error("META_ACCESS_TOKEN environment variable is not set");
  }
  if (!META_CATALOG_ID) {
    throw new Error("META_CATALOG_ID environment variable is not set");
  }
}

export async function metaApiRequest<T>(
  endpoint: string,
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>
): Promise<MetaApiResponse<T>> {
  validateConfig();

  const url = `${META_BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${META_ACCESS_TOKEN}`,
  };

  const options: RequestInit = { method, headers };

  if (body && method === "POST") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  return response.json() as Promise<MetaApiResponse<T>>;
}

export async function getCatalogProducts(
  fields: string[] = ["retailer_id", "availability", "inventory"],
  limit = 100
): Promise<MetaCatalogProduct[]> {
  validateConfig();

  const allProducts: MetaCatalogProduct[] = [];
  let nextUrl: string | null =
    `${META_BASE_URL}/${META_CATALOG_ID}/products?fields=${fields.join(",")}&limit=${limit}`;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
    });
    const data = (await response.json()) as MetaApiResponse<MetaCatalogProduct[]>;

    if (data.error) {
      throw new Error(`Meta API Error: ${data.error.message}`);
    }

    if (data.data) {
      allProducts.push(...data.data);
    }

    nextUrl = data.paging?.next || null;
  }

  return allProducts;
}

export async function getProductByRetailerId(
  retailerId: string
): Promise<MetaCatalogProduct | null> {
  validateConfig();

  const url = `${META_BASE_URL}/${META_CATALOG_ID}/products?filter={"retailer_id":{"eq":"${retailerId}"}}&fields=id,retailer_id,availability,inventory`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
  });
  const data = (await response.json()) as MetaApiResponse<MetaCatalogProduct[]>;

  if (data.error) {
    console.error("Meta API Error:", data.error);
    return null;
  }

  return data.data?.[0] || null;
}

export async function batchUpsertProducts(
  items: MetaBatchItem[]
): Promise<MetaBatchResponse> {
  validateConfig();

  const url = `${META_BASE_URL}/${META_CATALOG_ID}/items_batch`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      item_type: "PRODUCT_ITEM",
      requests: items,
    }),
  });

  return response.json() as Promise<MetaBatchResponse>;
}

export async function updateProductStock(
  retailerId: string,
  availability: "in stock" | "out of stock" | "preorder",
  inventory?: number
): Promise<boolean> {
  const item: MetaBatchItem = {
    method: "UPDATE",
    retailer_id: retailerId,
    data: {
      availability,
      ...(inventory !== undefined && { inventory }),
    },
  };

  const result = await batchUpsertProducts([item]);

  if (result.error) {
    console.error(`Failed to update stock for ${retailerId}:`, result.error);
    return false;
  }

  return true;
}

export async function fetchCatalogState(): Promise<Map<string, MetaCatalogProduct>> {
  const products = await getCatalogProducts();
  const map = new Map<string, MetaCatalogProduct>();

  for (const product of products) {
    map.set(product.retailer_id, product);
  }

  return map;
}
