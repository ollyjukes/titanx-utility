// File: next.config.mjs

/** @type {import('next').NextConfig} */
const nextConfig = {
  redirects: async () => {
    return [
      // Review this redirect; it may be unnecessary
      {
        source: '/:path+/',
        destination: '/:path+',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;