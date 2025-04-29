/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
      serverComponentsExternalPackages: ['viem', 'alchemy-sdk', 'zustand', 'node-cache'],
    },
  };
  export default nextConfig;