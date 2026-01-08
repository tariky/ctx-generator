import { serve } from "bun";
import index from "./index.html";
import { generateProductFeed, generateBothFeeds } from "./lib/woocommerce";
import { generateFastProductFeed, generateBothFastFeeds, refreshAndGenerateFeed } from "./lib/csv-generator";
import { handleWebhook } from "./lib/webhooks/handler";
import { performInitialSync } from "./lib/sync/initial-sync";
import { getCatalogInfo, getCatalogProducts, testSingleProductCreate, checkCatalogDiagnostics, getProductErrors, checkBatchStatus } from "./lib/meta/client";
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
        console.log("=== TEST PRODUCT ENDPOINT CALLED (GET) ===");
        try {
          const testProduct = {
            retailer_id: `test_${Date.now()}`,
            name: "Test Product",
            description: "This is a test product to verify Meta Catalog API connection",
            availability: "in stock",
            price: "10.00 BAM",
            url: "https://lunatik.ba/test-product",
            image_link: "https://lunatik-website.fra1.digitaloceanspaces.com/wp-content/uploads/2026/01/07131111/9mST4FOuXf-I6OhVHOCu1.jpg",
            brand: "Lunatik",
          };

          console.log("Creating test product:", JSON.stringify(testProduct, null, 2));
          const result = await testSingleProductCreate(testProduct);
          console.log("Test product result:", JSON.stringify(result, null, 2));
          return Response.json(result);
        } catch (error) {
          console.error("Error testing product creation:", error);
          return Response.json(
            { error: String(error) },
            { status: 500 }
          );
        }
      },
      async POST(req) {
        console.log("=== TEST PRODUCT ENDPOINT CALLED (POST) ===");
        try {
          const testProduct = {
            retailer_id: `test_${Date.now()}`,
            name: "Test Product",
            description: "This is a test product to verify Meta Catalog API connection",
            availability: "in stock",
            price: "10.00 BAM",
            url: "https://lunatik.ba/test-product",
            image_link: "https://lunatik-website.fra1.digitaloceanspaces.com/wp-content/uploads/2026/01/07131111/9mST4FOuXf-I6OhVHOCu1.jpg",
            brand: "Lunatik",
          };

          console.log("Creating test product:", JSON.stringify(testProduct, null, 2));
          const result = await testSingleProductCreate(testProduct);
          console.log("Test product result:", JSON.stringify(result, null, 2));
          return Response.json(result);
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
