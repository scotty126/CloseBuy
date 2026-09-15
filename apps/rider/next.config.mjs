/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@closebuy/ui", "@closebuy/types", "@closebuy/api-client"],
  reactStrictMode: true,
};

export default nextConfig;
