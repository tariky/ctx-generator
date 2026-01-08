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

  const requestBody = {
    item_type: "PRODUCT_ITEM",
    requests: items.map(item => ({
      method: item.method,
      retailer_id: item.retailer_id,
      data: {
        id: item.retailer_id,  // Required field - must match retailer_id
        ...item.data,
      },
    })),
  };

  console.log(`Sending batch request to: ${url}`);
  console.log(`Batch size: ${items.length} items`);
  console.log(`First item sample:`, JSON.stringify(items[0], null, 2));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const result = await response.json() as MetaBatchResponse;

  console.log(`Batch response status: ${response.status}`);
  console.log(`Batch response:`, JSON.stringify(result, null, 2));

  if (!response.ok) {
    console.error(`Meta API HTTP Error: ${response.status}`);
  }

  return result;
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

export async function getCatalogInfo(): Promise<any> {
  validateConfig();

  const url = `${META_BASE_URL}/${META_CATALOG_ID}?fields=id,name,product_count,vertical`;

  console.log(`Fetching catalog info from: ${url}`);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
  });

  const data = await response.json();
  console.log(`Catalog info:`, JSON.stringify(data, null, 2));

  return data;
}

export async function checkBatchStatus(handleId: string): Promise<any> {
  validateConfig();

  const url = `${META_BASE_URL}/${handleId}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
  });

  return response.json();
}

export async function testSingleProductCreate(testProduct: {
  retailer_id: string;
  name: string;
  description: string;
  availability: string;
  price: string;
  url: string;
  image_link: string;
  brand: string;
}): Promise<any> {
  validateConfig();

  const url = `${META_BASE_URL}/${META_CATALOG_ID}/items_batch`;

  const requestBody = {
    item_type: "PRODUCT_ITEM",
    requests: [{
      method: "CREATE",
      retailer_id: testProduct.retailer_id,
      data: {
        id: testProduct.retailer_id,  // Required field
        title: testProduct.name,  // Meta uses 'title' not 'name'
        description: testProduct.description || "No description",
        availability: testProduct.availability,
        price: testProduct.price,
        link: testProduct.url,  // Meta uses 'link' not 'url'
        image_link: testProduct.image_link,
        brand: testProduct.brand,
        condition: "new",
      },
    }],
  };

  console.log("Test product request:", JSON.stringify(requestBody, null, 2));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const result = await response.json();
  console.log("Test product response:", JSON.stringify(result, null, 2));

  return {
    httpStatus: response.status,
    result,
    requestSent: requestBody,
  };
}

export async function getProductErrors(limit = 50): Promise<any> {
  validateConfig();

  // Fetch products with errors from the catalog
  const url = `${META_BASE_URL}/${META_CATALOG_ID}/product_groups?fields=retailer_id,errors&limit=${limit}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
  });

  return response.json();
}

export async function getProductDetails(retailerId: string): Promise<any> {
  validateConfig();

  // Fetch product with all fields
  const fields = [
    "id",
    "retailer_id",
    "name",
    "description",
    "availability",
    "price",
    "url",
    "image_url",
    "additional_image_urls",
    "brand",
    "condition",
    "item_group_id",
    "size",
    "color",
    "product_type",
    "google_product_category",
  ].join(",");

  const url = `${META_BASE_URL}/${META_CATALOG_ID}/products?filter={"retailer_id":{"eq":"${retailerId}"}}&fields=${fields}`;

  console.log(`Fetching product details from: ${url}`);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
  });

  const data = await response.json();
  console.log(`Product details:`, JSON.stringify(data, null, 2));

  return data;
}

export async function getProductsByGroupId(groupId: string): Promise<any> {
  validateConfig();

  const fields = [
    "id",
    "retailer_id",
    "name",
    "description",
    "availability",
    "price",
    "url",
    "image_url",
    "additional_image_urls",
    "brand",
    "condition",
    "item_group_id",
    "size",
    "color",
    "product_type",
    "google_product_category",
  ].join(",");

  const url = `${META_BASE_URL}/${META_CATALOG_ID}/products?filter={"item_group_id":{"eq":"${groupId}"}}&fields=${fields}`;

  console.log(`Fetching products by group from: ${url}`);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
  });

  const data = await response.json();
  console.log(`Products in group:`, JSON.stringify(data, null, 2));

  return data;
}

export async function checkCatalogDiagnostics(): Promise<any> {
  validateConfig();

  // Check catalog diagnostics for any issues
  const url = `${META_BASE_URL}/${META_CATALOG_ID}?fields=id,name,product_count,vertical,da_display_settings`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
  });

  const catalogInfo = await response.json();

  // Also check for product feed status
  const feedsUrl = `${META_BASE_URL}/${META_CATALOG_ID}/product_feeds?fields=id,name,product_count,latest_upload`;
  const feedsResponse = await fetch(feedsUrl, {
    headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
  });
  const feedsInfo = await feedsResponse.json();

  return {
    catalog: catalogInfo,
    feeds: feedsInfo,
  };
}
