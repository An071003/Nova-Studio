import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@nova/ui', '@nova/shared', '@nova/editor-core', '@nova/editor-konva'],
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      canvas: false,
    };
    return config;
  },
  async rewrites() {
    const apiOrigin = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiOrigin}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
