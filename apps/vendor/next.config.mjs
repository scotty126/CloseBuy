/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@closebuy/ui", "@closebuy/types", "@closebuy/api-client"],
  reactStrictMode: true,
  webpack: (config) => {
    // @closebuy/types ships TypeScript source with NodeNext-style relative
    // imports (e.g. "./money.js" resolving to money.ts) -- required so
    // apps/api's real Node ESM runtime can load it directly with no build
    // step. Webpack doesn't remap .js -> .ts by default; this teaches it
    // to, the same way Next already does for the app's own first-party
    // source, so a value import (not just a type import) resolves.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
};

export default nextConfig;
