import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted Docker deployment runs `node server.js` from this trimmed
  // output instead of Netlify's per-request serverless functions — standalone
  // mode bundles only the production deps a request actually needs, avoiding
  // shipping the full node_modules into the image.
  output: "standalone",
  experimental: {
    // Only bundles the specific icons actually imported, instead of Fluent's
    // full icon set — this package is imported across nearly every page.
    optimizePackageImports: ["@fluentui/react-icons"],
  },
};

export default nextConfig;
