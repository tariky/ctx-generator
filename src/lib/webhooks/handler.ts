import { validateWebhookSignature, isValidSource } from "./validator";
import { processWebhookEvent } from "./processor";
import { logWebhookEvent, markWebhookProcessed, markWebhookError, type WebhookEventDetails } from "./events";
import { getProductById } from "../db/products";
import type { WCProduct } from "../types";

export async function handleWebhook(req: Request): Promise<Response> {
  // Extract headers
  const topic = req.headers.get("x-wc-webhook-topic");
  const signature = req.headers.get("x-wc-webhook-signature");
  const source = req.headers.get("x-wc-webhook-source");
  const deliveryId = req.headers.get("x-wc-webhook-delivery-id");

  // Validate topic
  if (!topic) {
    console.warn("Webhook received without topic");
    return new Response("Missing webhook topic", { status: 400 });
  }

  // Validate source (optional, for extra security)
  if (!isValidSource(source)) {
    console.warn(`Invalid webhook source: ${source}`);
    return new Response("Forbidden", { status: 403 });
  }

  // Parse payload
  const payload = await req.text();

  // Validate signature
  if (!validateWebhookSignature(payload, signature)) {
    console.warn("Invalid webhook signature");
    return new Response("Invalid signature", { status: 401 });
  }

  // Parse product data
  let productData: WCProduct;
  try {
    productData = JSON.parse(payload);
  } catch {
    console.error("Failed to parse webhook payload");
    return new Response("Invalid JSON", { status: 400 });
  }

  // Log webhook details for debugging
  console.log(`=== WEBHOOK RECEIVED ===`);
  console.log(`Topic: ${topic}`);
  console.log(`Product ID: ${productData.id}`);
  console.log(`Product Name: ${productData.name}`);
  console.log(`Product Type: ${productData.type}`);
  console.log(`Parent ID: ${productData.parent_id}`);
  console.log(`Stock Status: ${productData.stock_status}`);
  console.log(`Stock Quantity: ${productData.stock_quantity}`);
  console.log(`========================`);

  // Get existing product state for comparison
  const existingProduct = getProductById(productData.id);
  const [, actionType] = topic.split(".") as [string, "created" | "updated" | "deleted" | "restored"];

  // Build event details
  const eventDetails: WebhookEventDetails = {
    productName: productData.name,
    productType: productData.type,
    actionType: actionType,
    oldStockStatus: existingProduct?.stock_status,
    newStockStatus: productData.stock_status,
    oldStockQuantity: existingProduct?.stock_quantity ?? undefined,
    newStockQuantity: productData.stock_quantity ?? undefined,
  };

  // Log webhook event with details
  const eventId = logWebhookEvent(topic, productData.id, payload, signature, eventDetails);

  // Return 200 immediately to avoid timeout, then process async
  const response = new Response("OK", { status: 200 });

  // Process asynchronously (don't await)
  processWebhookEvent(topic, productData)
    .then(() => {
      markWebhookProcessed(eventId);
      console.log(`Webhook ${deliveryId} processed successfully`);
    })
    .catch((error) => {
      const errorMsg = error instanceof Error ? error.message : String(error);
      markWebhookError(eventId, errorMsg);
      console.error(`Webhook ${deliveryId} processing failed:`, error);
    });

  return response;
}
