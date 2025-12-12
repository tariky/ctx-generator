import Papa from "papaparse";

const WC_API_URL = process.env.WC_API_URL;
const WC_CONSUMER_KEY = process.env.WC_CONSUMER_KEY;
const WC_CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET;
const WC_BRAND = process.env.WC_BRAND || "My Brand";
const WC_CURRENCY = process.env.WC_CURRENCY || "USD";

const MAX_RETRIES = 3;

async function fetchWooCommerce(endpoint: string, params: Record<string, string> = {}) {
  if (!WC_API_URL || !WC_CONSUMER_KEY || !WC_CONSUMER_SECRET) {
    throw new Error("WooCommerce configuration missing");
  }

  const url = new URL(`${WC_API_URL}/wp-json/wc/v3${endpoint}`);
  url.searchParams.append("consumer_key", WC_CONSUMER_KEY);
  url.searchParams.append("consumer_secret", WC_CONSUMER_SECRET);
  
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`WooCommerce API Error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

// Types based on WooCommerce API
interface WCImage {
  id: number;
  src: string;
}

interface WCProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  type: string;
  status: string;
  description: string;
  short_description: string;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  date_on_sale_from: string | null;
  date_on_sale_to: string | null;
  stock_status: string;
  stock_quantity: number | null;
  images: WCImage[];
  attributes: any[];
  variations: number[];
  parent_id: number;
  categories: { id: number; name: string }[];
}

interface MetaProduct {
  id: string;
  title: string;
  description: string;
  rich_text_description?: string;
  availability: "in stock" | "out of stock" | "preorder";
  condition: "new" | "refurbished" | "used";
  price: string;
  link: string;
  image_link: string;
  brand: string;
  additional_image_link?: string;
  age_group?: string;
  color?: string;
  gender?: string;
  item_group_id?: string;
  google_product_category?: string;
  product_type?: string;
  sale_price?: string;
  sale_price_effective_date?: string;
  size?: string;
  status: "active" | "archived";
  inventory?: number;
}

function stripHtml(html: string): string {
  if (!html) return "";
  // 1. Replace <br>, <p>, </div>, etc with newlines to preserve some structure
  const withNewlines = html.replace(/<br\s*\/?>/gi, "\n")
                           .replace(/<\/p>/gi, "\n")
                           .replace(/<\/div>/gi, "\n")
                           .replace(/<\/li>/gi, "\n");
  
  // 2. Remove all other tags
  const text = withNewlines.replace(/<[^>]*>/g, "");
  
  // 3. Decode entities (basic ones) - for a robust solution, use a library like 'he'
  const decoded = text.replace(/&nbsp;/g, " ")
                      .replace(/&amp;/g, "&")
                      .replace(/&lt;/g, "<")
                      .replace(/&gt;/g, ">")
                      .replace(/&quot;/g, '"')
                      .replace(/&#39;/g, "'");

  // 4. Collapse whitespace
  return decoded.replace(/\s+/g, " ").trim();
}

function mapToMetaProduct(product: WCProduct, parent?: WCProduct): MetaProduct {
  // Use parent data if variation, but override with variation specific data
  const mainProduct = parent || product;
  
  const id = `wc_${product.id}`;
  const title = mainProduct.name;
  
  // strip HTML from description for plain description
  const description = stripHtml(product.description || mainProduct.description).slice(0, 5000);
  const rich_text_description = stripHtml(product.description || mainProduct.description);
  
  const availability = product.stock_status === "instock" ? "in stock" : 
                       product.stock_status === "onbackorder" ? "preorder" : "out of stock";
  
  const price = `${product.regular_price || product.price} ${WC_CURRENCY}`;
  const sale_price = product.sale_price ? `${product.sale_price} ${WC_CURRENCY}` : undefined;
  
  const link = product.permalink;
  const original_image_link = product.images?.[0]?.src || mainProduct.images?.[0]?.src || "";
  const additional_image_link = product.images?.slice(1).map(i => i.src).join(",") || undefined;
  
  const priceForImage = `${product.regular_price || product.price}KM`;
  const salePriceForImage = product.sale_price ? `${product.sale_price}KM` : "";
  const encodedName = encodeURIComponent(title);
  const encodedPrice = encodeURIComponent(priceForImage);
  const encodedSalePrice = encodeURIComponent(salePriceForImage);
  const encodedImg = original_image_link ? Buffer.from(original_image_link).toString("base64") : "";
  
  const image_link = original_image_link ? `https://imgen.lunatik.cloud/?price=${encodedPrice}&discount_price=${encodedSalePrice}&name=${encodedName}&img=${encodedImg}` : "";
  
  const brand = WC_BRAND;
  
  // Extract attributes (color, size, etc.)
  let color = undefined;
  let size = undefined;
  let gender = undefined;
  let age_group = undefined;

  const allAttributes = [...(parent?.attributes || []), ...(product.attributes || [])];
  
  for (const attr of allAttributes) {
    const name = attr.name.toLowerCase();
    const option = attr.option || (attr.options && attr.options[0]);
    if (name.includes("color")) color = option;
    if (name.includes("size")) size = option;
    if (name.includes("gender")) gender = option;
    if (name.includes("age")) age_group = option;
  }

  return {
    id,
    title,
    description,
    rich_text_description,
    availability,
    condition: "new",
    price,
    link,
    image_link,
    brand,
    additional_image_link,
    age_group,
    color,
    gender,
    item_group_id: parent ? `wc_${parent.id}` : `wc_${product.id}`,
    google_product_category: "", // Map from category if possible
    product_type: product.categories?.map(c => c.name).join(" > "),
    sale_price,
    size,
    status: "active",
    inventory: product.stock_quantity ?? undefined,
  };
}

export async function generateProductFeed(): Promise<string> {
  // 1. Fetch Products
  const products: WCProduct[] = await fetchWooCommerce("/products", { per_page: "50" }); // Limit for demo
  
  const feedItems: MetaProduct[] = [];

  for (const product of products) {
    if (product.type === "variable" && product.variations.length > 0) {
      // Fetch variations to calculate total inventory and check availability
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

      // Create a single product entry representing the main product
      const item = mapToMetaProduct(product);
      
      // Override inventory with the sum of variations
      item.inventory = totalInventory > 0 ? totalInventory : undefined;
      
      // If any variation is in stock, consider the product in stock (or use main product status if managed there)
      if (hasInStock || product.stock_status === "instock") {
        item.availability = "in stock";
        feedItems.push(item);
      }
      
      // Also add variations to the feed
      for (const variation of variations) {
        const variantItem = mapToMetaProduct(variation, product);
        if (variantItem.availability === "in stock") {
          feedItems.push(variantItem);
        }
      }
    } else {
      // Simple product or other types
      const item = mapToMetaProduct(product);
      if (item.availability === "in stock") {
        feedItems.push(item);
      }
    }
  }

  // 2. Convert to CSV
  const csv = Papa.unparse(feedItems, {
    quotes: true, // Force quotes around fields to handle HTML/commas
    columns: [
      "id", "title", "description", "rich_text_description", "availability", 
      "condition", "price", "link", "image_link", "brand", 
      "additional_image_link", "age_group", "color", "gender", 
      "item_group_id", "google_product_category", "product_type", 
      "sale_price", "sale_price_effective_date", "size", "status", "inventory"
    ]
  });

  return csv;
}

