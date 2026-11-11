import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { legacyMarketingPaths } from './src/lib/legacy-marketing-pages';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  async headers() {
    return [
      ...legacyMarketingPaths.map((source) => ({
        source,
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, follow' }],
      })),
      {
        source: '/connect',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      {
        source: '/connector-logos/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  experimental: {
    proxyClientMaxBodySize: '50mb',
  },
};

export default nextConfig;
