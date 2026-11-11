import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { legacyMarketingPaths } from './src/lib/legacy-marketing-pages';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  async redirects() {
    // Move only public marketing URLs. Account, API and authentication stay on their host.
    const publicPaths = ['/', '/pricing', '/download', '/contact', '/terms', '/privacy', '/agents/:path*', '/guides/:path*'];
    return ['altselfs.com', 'www.altselfs.com'].flatMap(host => publicPaths.map(source => ({
      source,
      has: [{ type: 'host' as const, value: host }],
      destination: `https://minaco.ai${source}`,
      permanent: true,
    })));
  },
  async headers() {
    return [
      {
        // This document exists only to render the embedded product demo.
        source: '/landing/workflow-demo.html',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, follow' }],
      },
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
