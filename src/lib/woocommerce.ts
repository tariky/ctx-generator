import { stringify } from "csv-stringify/sync";
import { Base64 } from "js-base64";
import type { WCProduct, MetaProduct } from "./types";
import { Worker } from "worker_threads";
import path from "path";
import os from "os";
import { generateMetaRetailerId, generateItemGroupId } from "./utils/retailer-id";

const WC_API_URL = process.env.WC_API_URL;
const WC_CONSUMER_KEY = process.env.WC_CONSUMER_KEY;
const WC_CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET;
const WC_BRAND = process.env.WC_BRAND || "Lunatik";
const WC_CURRENCY = process.env.WC_CURRENCY || "BAM";

const MAX_RETRIES = 3;

export async function fetchWooCommerce(
	endpoint: string,
	params: Record<string, string> = {}
) {
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
		throw new Error(
			`WooCommerce API Error: ${response.status} ${response.statusText}`
		);
	}
	return response.json();
}

function stripHtml(html: string): string {
	if (!html) return "";
	// 1. Replace <br>, <p>, </div>, etc with newlines to preserve some structure
	const withNewlines = html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n")
		.replace(/<\/div>/gi, "\n")
		.replace(/<\/li>/gi, "\n");

	// 2. Remove all other tags
	const text = withNewlines.replace(/<[^>]*>/g, "");

	// 3. Decode entities (basic ones) - for a robust solution, use a library like 'he'
	const decoded = text
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");

	// 4. Collapse whitespace
	return decoded.replace(/\s+/g, " ").trim();
}

export function mapToMetaProduct(
	product: WCProduct,
	parent?: WCProduct,
	style: "standard" | "christmas" = "standard"
): MetaProduct {
	// Use parent data if variation, but override with variation specific data
	const mainProduct = parent || product;

	// Use centralized ID generation for consistency across sync and webhooks
	const id = generateMetaRetailerId(product, parent);

	const title = mainProduct.name;

	// strip HTML from description for plain description
	const description = stripHtml(
		product.description || mainProduct.description
	).slice(0, 5000);
	const rich_text_description = stripHtml(
		product.description || mainProduct.description
	);

	const availability =
		product.stock_status === "instock"
			? "in stock"
			: product.stock_status === "onbackorder"
			? "preorder"
			: "out of stock";

	const price = `${product.regular_price || product.price} ${WC_CURRENCY}`;
	const sale_price = product.sale_price
		? `${product.sale_price} ${WC_CURRENCY}`
		: undefined;

	const link = product.permalink || mainProduct.permalink;
	// Variations use 'image' (singular), products use 'images' (array)
	const original_image_link =
		product.image?.src || product.images?.[0]?.src || mainProduct.images?.[0]?.src || "";
	// Only use the three generated multi-ratio images via imgen service, no additional WooCommerce images

	const priceForImage = `${product.regular_price || product.price} KM`;
	const hasSalePrice = !!product.sale_price && product.sale_price !== "";
	const salePriceForImage = hasSalePrice ? `${product.sale_price} KM` : "";

	const encodedName = encodeURIComponent(title);
	const encodedPrice = encodeURIComponent(priceForImage);
	const encodedSalePrice = encodeURIComponent(salePriceForImage);
	const encodedImg = original_image_link
		? Base64.encode(original_image_link, true)
		: "";

	// Generate multi-ratio images with tags
	// Each ratio gets its own imgen URL with the appropriate aspect_ratio parameter
	let image_link = "";
	const images: Array<{ url: string; tag: string[] }> = [];

	// CSV format columns (for backward compatibility with CSV export)
	const imageEntries: Record<string, string> = {
		"image[0].url": "",
		"image[0].tag[0]": "",
		"image[1].url": "",
		"image[1].tag[0]": "",
		"image[2].url": "",
		"image[2].tag[0]": "",
		"image[2].tag[1]": "",
	};

	if (original_image_link) {
		// Only include discount_price param if there's actually a sale price
		const discountParam = hasSalePrice ? `&discount_price=${encodedSalePrice}` : "";
		const baseParams = `price=${encodedPrice}${discountParam}&name=${encodedName}&img=${encodedImg}&style=${style}`;

		// Image 0: 1:1 square - Default image (no tag needed, first image is default)
		const imgenUrl1x1 = `https://imgen.lunatik.cloud/?${baseParams}&aspect_ratio=1:1`;
		image_link = imgenUrl1x1;
		images.push({ url: imgenUrl1x1, tag: [] });  // Default image, no tag
		imageEntries["image[0].url"] = imgenUrl1x1;
		imageEntries["image[0].tag[0]"] = "";

		// Image 1: 4:5 portrait for feed placements
		const imgenUrl4x5 = `https://imgen.lunatik.cloud/?${baseParams}&aspect_ratio=4:5`;
		images.push({ url: imgenUrl4x5, tag: ["ASPECT_RATIO_4_5_PREFERRED"] });
		imageEntries["image[1].url"] = imgenUrl4x5;
		imageEntries["image[1].tag[0]"] = "ASPECT_RATIO_4_5_PREFERRED";

		// Image 2: 9:16 for Stories and Reels (both tags for full coverage)
		const imgenUrl9x16 = `https://imgen.lunatik.cloud/?${baseParams}&aspect_ratio=9:16`;
		images.push({ url: imgenUrl9x16, tag: ["STORY_PREFERRED", "REELS_PREFERRED"] });
		imageEntries["image[2].url"] = imgenUrl9x16;
		imageEntries["image[2].tag[0]"] = "STORY_PREFERRED";
		imageEntries["image[2].tag[1]"] = "REELS_PREFERRED";
	}

	const brand = WC_BRAND;

	// Extract attributes (color, size, etc.)
	let color = undefined;
	let size = undefined;
	let gender = undefined;
	let age_group = undefined;

	const allAttributes = [
		...(parent?.attributes || []),
		...(product.attributes || []),
	];

	for (const attr of allAttributes) {
		const name = attr.name.toLowerCase();
		const option = attr.option || (attr.options && attr.options[0]);
		if (name.includes("color")) color = option;
		if (name.includes("size")) size = option;
		if (name.includes("gender")) gender = option;
		if (name.includes("age")) age_group = option;
	}

	const baseProduct: MetaProduct & Record<string, any> = {
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
		// Multi-ratio images array for Meta API
		images: images.length > 0 ? images : undefined,
		age_group,
		color,
		gender,
		size,
		// Use centralized item_group_id generation for consistency
		item_group_id: generateItemGroupId(product, parent),
		// Use parent categories for variations, own categories for main products
		google_product_category: "", // Can be mapped from category if needed
		product_type: (parent?.categories || product.categories)?.map((c) => c.name).join(" > ") || "",
		sale_price,
		status: "active",
		// Set inventory to 0 for out of stock products, otherwise use stock_quantity
		inventory:
			product.stock_status === "outofstock"
				? 0
				: product.stock_quantity ?? undefined,
	};

	// Merge multi-ratio image entries (for CSV export backward compatibility)
	return { ...baseProduct, ...imageEntries };
}

export async function fetchAllProducts(
	endpoint: string,
	params: Record<string, string> = {}
): Promise<WCProduct[]> {
	let allProducts: WCProduct[] = [];
	let page = 1;
	const perPage = 100;

	console.log(`Starting fetch for ${endpoint}...`);

	while (true) {
		console.log(`Fetching page ${page}...`);
		const pageParams = {
			...params,
			page: page.toString(),
			per_page: perPage.toString(),
		};
		const products: WCProduct[] = await fetchWooCommerce(
			endpoint,
			pageParams
		);

		if (products.length === 0) {
			console.log(`Page ${page} is empty. Fetching complete.`);
			break;
		}

		allProducts = [...allProducts, ...products];
		console.log(
			`Fetched ${products.length} products (Total: ${allProducts.length})`
		);

		if (products.length < perPage) {
			console.log(
				`Page ${page} has fewer than ${perPage} items. Fetching complete.`
			);
			break;
		}

		page++;
	}

	console.log(`Total products fetched: ${allProducts.length}`);
	return allProducts;
}

export async function generateProductFeed(
	style: "standard" | "christmas" = "standard"
): Promise<string> {
	// 1. Fetch only in-stock products
	const products: WCProduct[] = await fetchAllProducts("/products", { stock_status: "instock" });

	console.log(
		`Fetched ${products.length} products. Starting parallel processing with style: ${style}...`
	);

	// 2. Parallel Processing with Workers
	const numCPUs = os.cpus().length;
	// Use at most 4 workers or fewer if fewer items
	const numWorkers = Math.min(numCPUs, 4, Math.ceil(products.length / 10));
	const chunkSize = Math.ceil(products.length / numWorkers);

	const workerPromises: Promise<MetaProduct[]>[] = [];

	for (let i = 0; i < numWorkers; i++) {
		const start = i * chunkSize;
		const end = start + chunkSize;
		const chunk = products.slice(start, end);

		if (chunk.length === 0) continue;

		workerPromises.push(
			new Promise((resolve, reject) => {
				const worker = new Worker(
					path.resolve(import.meta.dir, "worker.ts"),
					{
						workerData: {
							products: chunk,
							WC_API_URL,
							WC_CONSUMER_KEY,
							WC_CONSUMER_SECRET,
							WC_BRAND,
							WC_CURRENCY,
							style,
						},
					}
				);

				worker.on("message", (result: MetaProduct[]) => resolve(result));
				worker.on("error", reject);
				worker.on("exit", (code) => {
					if (code !== 0)
						reject(new Error(`Worker stopped with exit code ${code}`));
				});
			})
		);
	}

	const results = await Promise.all(workerPromises);
	const feedItems = results.flat();

	// 3. Convert to CSV
	console.log(
		`Processing ${feedItems.length} items for CSV generation (style: ${style})...`
	);

	// Base columns + multi-ratio image columns
	const columns = [
		"id",
		"title",
		"description",
		"rich_text_description",
		"availability",
		"condition",
		"price",
		"link",
		"image_link",
		"brand",
		// Multi-ratio image columns (only these three images, no additional WooCommerce images)
		"image[0].url",
		"image[0].tag[0]",
		"image[1].url",
		"image[1].tag[0]",
		"image[2].url",
		"image[2].tag[0]",
		"image[2].tag[1]",
		// Rest of columns
		"age_group",
		"color",
		"gender",
		"item_group_id",
		"google_product_category",
		"product_type",
		"sale_price",
		"sale_price_effective_date",
		"size",
		"status",
		"inventory",
	];

	let csv = "";
	try {
		csv = stringify(feedItems, {
			header: true,
			columns: columns,
			quoted: true, // Force quotes for safety
		});
		console.log(`CSV generation complete for style: ${style}.`);
	} catch (err) {
		console.error("Error generating CSV:", err);
		throw err;
	}

	return csv;
}

export async function generateBothFeeds(): Promise<{
	standard: string;
	christmas: string;
}> {
	console.log("Generating both standard and christmas feeds...");

	const [standardFeed, christmasFeed] = await Promise.all([
		generateProductFeed("standard"),
		generateProductFeed("christmas"),
	]);

	console.log("Both feeds generated successfully.");
	return { standard: standardFeed, christmas: christmasFeed };
}
