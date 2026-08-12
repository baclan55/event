import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  compress: true,
  async headers() {
    // HTML главной не кэшировать на год (дефолт force-static).
    return [
      {
        source: '/',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, s-maxage=60, must-revalidate' }],
      },
      {
        source: '/apply',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, s-maxage=60, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
