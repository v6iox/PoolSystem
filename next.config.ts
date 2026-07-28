import type { NextConfig } from "next";
import packageJson from "./package.json";

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    // Single source of truth for the version shown in the UI.
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
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
