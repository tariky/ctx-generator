import { createHmac } from "crypto";

const WC_WEBHOOK_SECRET = process.env.WC_WEBHOOK_SECRET;

export function validateWebhookSignature(
  payload: string,
  signature: string | null
): boolean {
  if (!signature || !WC_WEBHOOK_SECRET) {
    console.warn("Missing webhook signature or secret");
    return false;
  }

  const expectedSignature = createHmac("sha256", WC_WEBHOOK_SECRET)
    .update(payload)
    .digest("base64");

  return signature === expectedSignature;
}

export function isValidSource(source: string | null): boolean {
  const WC_API_URL = process.env.WC_API_URL;
  if (!source || !WC_API_URL) return false;

  try {
    const sourceUrl = new URL(source);
    const expectedUrl = new URL(WC_API_URL);
    return sourceUrl.hostname === expectedUrl.hostname;
  } catch {
    return false;
  }
}
