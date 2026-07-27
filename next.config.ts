import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // No floating Next.js dev-tools badge over the pool UI (dev-only overlay;
  // production never shows it either way).
  devIndicators: false,
  serverExternalPackages: ["better-sqlite3", "web-push", "node-cron"],
  outputFileTracingIncludes: {
    "/**": ["./src/server/db/schema.sql"],
  },
  eslint: { ignoreDuringBuilds: true },
  headers: async () => [
    {
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    },
  ],
};

export default nextConfig;
