import { serve } from "bun";
import index from "./index.html";
import { generateProductFeed, generateBothFeeds } from "./lib/woocommerce";

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
          const { standard, christmas } = await generateBothFeeds();
          await Bun.write("public/product_catalog_standard.csv", standard);
          await Bun.write("public/product_catalog_christmas.csv", christmas);
          return Response.json({ 
            success: true, 
            message: "Both catalogs generated successfully", 
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

    "/api/catalog": {
      async GET(req) {
        try {
          const url = new URL(req.url);
          const style = url.searchParams.get("style") || "standard";
          const validStyle = style === "christmas" ? "christmas" : "standard";
          
          const csv = await generateProductFeed(validStyle);
          return new Response(csv, {
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": `attachment; filename="product_catalog_${validStyle}.csv"`,
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
