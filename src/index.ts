import { serve } from "bun";
import index from "./index.html";
import { generateProductFeed, generateBothFeeds } from "./lib/woocommerce";
import { generateFastProductFeed, generateBothFastFeeds, refreshAndGenerateFeed } from "./lib/csv-generator";
import { handleWebhook } from "./lib/webhooks/handler";
import { performInitialSync } from "./lib/sync/initial-sync";
import { getCatalogInfo, getCatalogProducts, testSingleProductCreate, checkCatalogDiagnostics, getProductErrors, checkBatchStatus, getProductDetails, getProductsByGroupId } from "./lib/meta/client";
import { getProductCount, getInStockCount, getAllProducts } from "./lib/db/products";
import { getSyncedCount, getPendingCount, getErrorCount } from "./lib/db/sync-status";
import { getWebhookEventCount, getRecentWebhookEvents } from "./lib/webhooks/events";
import { getDb } from "./lib/db/index";
import {
  validateCredentials,
  createSession,
  validateSession,
  deleteSession,
  getSessionFromRequest,
} from "./lib/auth/session";

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/product_catalog_standard.csv": async () => {
      const file = Bun.file("public/product_catalog_standard.csv");
      if (await file.exists()) {
        return new Response(file);
      }
      return new Response("Standard catalog not found. Please generate it first.", { status: 404 });
    },

    "/product_catalog_christmas.csv": async () => {
      const file = Bun.file("public/product_catalog_christmas.csv");
      if (await file.exists()) {
        return new Response(file);
      }
      return new Response("Christmas catalog not found. Please generate it first.", { status: 404 });
    },

    "/api/catalog/generate": {
      async GET(req) {
        try {
          const url = new URL(req.url);
          const refresh = url.searchParams.get("refresh") === "true";

          const startTime = Date.now();
          let standard: string, christmas: string;

          if (refresh) {
            // Slow: fetch fresh from WooCommerce
            console.log("Generating with fresh WooCommerce data...");
            [standard, christmas] = await Promise.all([
              refreshAndGenerateFeed("standard"),
              refreshAndGenerateFeed("christmas"),
            ]);
          } else {
            // Fast: use cached data
            console.log("Generating from cache...");
            const feeds = await generateBothFastFeeds();
            standard = feeds.standard;
            christmas = feeds.christmas;
          }

          await Bun.write("public/product_catalog_standard.csv", standard);
          await Bun.write("public/product_catalog_christmas.csv", christmas);

          const elapsed = Date.now() - startTime;
          return Response.json({
            success: true,
            message: `Both catalogs generated in ${elapsed}ms`,
            elapsed,
            urls: {
              standard: "/product_catalog_standard.csv",
              christmas: "/product_catalog_christmas.csv"
            }
          });
        } catch (error) {
          console.error("Catalog generation error:", error);
          return new Response(JSON.stringify({ error: "Error generating catalog", details: String(error) }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      },
    },

    "/api/catalog/refresh": {
      async GET(req) {
        try {
          const url = new URL(req.url);
          const style = url.searchParams.get("style") || "standard";
          const validStyle = style === "christmas" ? "christmas" : "standard";

          const startTime = Date.now();
          const csv = await refreshAndGenerateFeed(validStyle);
          const elapsed = Date.now() - startTime;

          return new Response(csv, {
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": `attachment; filename="product_catalog_${validStyle}.csv"`,
              "X-Generation-Time": `${elapsed}ms`,
            },
          });
        } catch (error) {
          console.error("Catalog refresh error:", error);
          return new Response(JSON.stringify({ error: "Error refreshing catalog", details: String(error) }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      },
    },

    "/api/catalog": {
      async GET(req) {
        try {
          const url = new URL(req.url);
          const style = url.searchParams.get("style") || "standard";
          const validStyle = style === "christmas" ? "christmas" : "standard";
          const slow = url.searchParams.get("slow") === "true";

          const startTime = Date.now();
          let csv: string;

          if (slow) {
            // Original slow method (fetches from WooCommerce each time)
            csv = await generateProductFeed(validStyle);
          } else {
            // Fast method using cache
            csv = await generateFastProductFeed(validStyle);
          }

          const elapsed = Date.now() - startTime;

          return new Response(csv, {
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": `attachment; filename="product_catalog_${validStyle}.csv"`,
              "X-Generation-Time": `${elapsed}ms`,
            },
          });
        } catch (error) {
          console.error("Catalog generation error:", error);
          return new Response(JSON.stringify({ error: "Error generating catalog", details: String(error) }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      },
    },

    "/api/webhooks/woocommerce": {
      async POST(req) {
        return handleWebhook(req);
      },
    },

    "/api/sync/initial": {
      async POST(req) {
        try {
          const report = await performInitialSync();
          return Response.json({ success: true, report });
        } catch (error) {
          console.error("Initial sync error:", error);
          return Response.json(
            { success: false, error: String(error) },
            { status: 500 }
          );
        }
      },
    },

    "/api/sync/status": {
      async GET(req) {
        try {
          // Initialize DB if not already
          getDb();

          const stats = {
            products: {
              total: getProductCount(),
              inStock: getInStockCount(),
            },
            sync: {
              synced: getSyncedCount(),
              pending: getPendingCount(),
              errors: getErrorCount(),
            },
            webhooks: getWebhookEventCount(),
            recentWebhooks: getRecentWebhookEvents(5),
          };
          return Response.json(stats);
        } catch (error) {
          console.error("Error getting sync status:", error);
          return Response.json(
            { error: String(error) },
            { status: 500 }
          );
        }
      },
    },

    "/api/meta/catalog": {
      async GET(req) {
        try {
          const catalogInfo = await getCatalogInfo();
          const products = await getCatalogProducts();
          return Response.json({
            catalog: catalogInfo,
            productCount: products.length,
            sampleProducts: products.slice(0, 5),
          });
        } catch (error) {
          console.error("Error getting catalog info:", error);
          return Response.json(
            { error: String(error) },
            { status: 500 }
          );
        }
      },
    },

    "/api/meta/diagnostics": {
      async GET(req) {
        try {
          const diagnostics = await checkCatalogDiagnostics();
          const errors = await getProductErrors(20);
          return Response.json({
            ...diagnostics,
            productErrors: errors,
          });
        } catch (error) {
          console.error("Error getting diagnostics:", error);
          return Response.json(
            { error: String(error) },
            { status: 500 }
          );
        }
      },
    },

    "/api/meta/test-product": {
      async GET(req) {
        console.log("=== TEST PRODUCT WITH VARIANTS ENDPOINT CALLED ===");
        try {
          const timestamp = Date.now();
          const groupId = `test_group_${timestamp}`;
          const baseImage = "https://lunatik-website.fra1.digitaloceanspaces.com/wp-content/uploads/2026/01/07131111/9mST4FOuXf-I6OhVHOCu1.jpg";
          const encodedImg = Buffer.from(baseImage).toString('base64');

          // Create test variants with different sizes
          const variants = [
            { size: "S", price: "49.00 BAM" },
            { size: "M", price: "49.00 BAM" },
            { size: "L", price: "52.00 BAM" },
          ];

          const requests = variants.map((variant) => {
            const encodedPrice = encodeURIComponent(variant.price);
            const encodedName = encodeURIComponent(`Test Product - ${variant.size}`);
            const baseParams = `price=${encodedPrice}&name=${encodedName}&img=${encodedImg}`;

            return {
              method: "CREATE" as const,
              retailer_id: `${groupId}_${variant.size}`,
              data: {
                id: `${groupId}_${variant.size}`,
                title: `Test Product - ${variant.size}`,
                description: "This is a test product with variants and multi-ratio images to verify Meta Catalog API",
                availability: "in stock",
                price: variant.price,
                link: "https://lunatik.ba/test-product",
                brand: "Lunatik",
                condition: "new",
                item_group_id: groupId,
                size: variant.size,
                product_type: "Clothing > T-Shirts",  // Category hierarchy
                // Multi-ratio images using proper array format with Meta tags
                image: [
                  {
                    url: `https://imgen.lunatik.cloud/?${baseParams}&aspect_ratio=1:1`,
                    tag: []  // Default image, no tag needed
                  },
                  {
                    url: `https://imgen.lunatik.cloud/?${baseParams}&aspect_ratio=4:5`,
                    tag: ["ASPECT_RATIO_4_5_PREFERRED"]  // 4:5 feed placements
                  },
                  {
                    url: `https://imgen.lunatik.cloud/?${baseParams}&aspect_ratio=9:16`,
                    tag: ["STORY_PREFERRED", "REELS_PREFERRED"]  // Stories and Reels
                  }
                ],
              },
            };
          });

          const url = "https://graph.facebook.com/v21.0/" + process.env.META_CATALOG_ID + "/items_batch";
          const requestBody = {
            item_type: "PRODUCT_ITEM",
            requests: requests,
          };

          console.log("Creating test products with variants:", JSON.stringify(requestBody, null, 2));

          const response = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
          });

          const result = await response.json();
          console.log("Test products result:", JSON.stringify(result, null, 2));

          return Response.json({
            httpStatus: response.status,
            result,
            requestSent: requestBody,
            groupId,
            variantsCreated: variants.length,
          });
        } catch (error) {
          console.error("Error testing product creation:", error);
          return Response.json(
            { error: String(error) },
            { status: 500 }
          );
        }
      },
    },

    "/api/meta/batch-status/:handleId": async (req) => {
      try {
        const handleId = req.params.handleId;
        const status = await checkBatchStatus(handleId);
        return Response.json(status);
      } catch (error) {
        console.error("Error checking batch status:", error);
        return Response.json(
          { error: String(error) },
          { status: 500 }
        );
      }
    },

    "/api/meta/product/:retailerId": async (req) => {
      try {
        const retailerId = req.params.retailerId;
        console.log(`Fetching product: ${retailerId}`);
        const product = await getProductDetails(retailerId);
        return Response.json(product);
      } catch (error) {
        console.error("Error fetching product:", error);
        return Response.json(
          { error: String(error) },
          { status: 500 }
        );
      }
    },

    "/api/meta/group/:groupId": async (req) => {
      try {
        const groupId = req.params.groupId;
        console.log(`Fetching products in group: ${groupId}`);
        const products = await getProductsByGroupId(groupId);
        return Response.json(products);
      } catch (error) {
        console.error("Error fetching group products:", error);
        return Response.json(
          { error: String(error) },
          { status: 500 }
        );
      }
    },

    "/api/products": {
      async GET(req) {
        try {
          const url = new URL(req.url);
          const limit = parseInt(url.searchParams.get("limit") || "100");
          const offset = parseInt(url.searchParams.get("offset") || "0");
          const products = getAllProducts(limit, offset);
          return Response.json({
            products,
            total: getProductCount(),
            limit,
            offset,
          });
        } catch (error) {
          console.error("Error getting products:", error);
          return Response.json(
            { error: String(error) },
            { status: 500 }
          );
        }
      },
    },

    "/api/auth/login": {
      async POST(req) {
        try {
          const body = await req.json();
          const { username, password } = body as { username: string; password: string };

          if (!validateCredentials(username, password)) {
            return Response.json(
              { success: false, error: "Invalid credentials" },
              { status: 401 }
            );
          }

          const token = createSession();
          return new Response(
            JSON.stringify({ success: true }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Set-Cookie": `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
              },
            }
          );
        } catch (error) {
          console.error("Login error:", error);
          return Response.json(
            { success: false, error: "Login failed" },
            { status: 500 }
          );
        }
      },
    },

    "/api/auth/logout": {
      async POST(req) {
        const token = getSessionFromRequest(req);
        if (token) {
          deleteSession(token);
        }
        return new Response(
          JSON.stringify({ success: true }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": "session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
            },
          }
        );
      },
    },

    "/api/auth/check": {
      async GET(req) {
        const token = getSessionFromRequest(req);
        const authenticated = validateSession(token);
        return Response.json({ authenticated });
      },
    },

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },
  port: 3005,
  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
  idleTimeout: 255, // 5 minutes timeout for long-running generation
});

console.log(`🚀 Server running at ${server.url}`);
