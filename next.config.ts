import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Only bundles the specific icons actually imported, instead of Fluent's
    // full icon set — this package is imported across nearly every page.
    optimizePackageImports: ["@fluentui/react-icons"],
  },
};

export default nextConfig;
