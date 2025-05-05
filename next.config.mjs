// ./next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['viem', 'alchemy-sdk'],
  webpack: (config) => {
    config.resolve.fallback = { fs: false, path: false };
    config.module.rules.push({
      test: /\.json$/,
      type: 'json',
    });
    return config;
  },
};

export default nextConfig;
