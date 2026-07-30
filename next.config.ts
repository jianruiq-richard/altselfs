import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'www.gstatic.com' },
      { protocol: 'https', hostname: 'p16-hera-overseas.larksuitecdn.com' },
      { protocol: 'https', hostname: 'rapidapi-prod-apis.s3.amazonaws.com' },
    ],
  },
  experimental: {
    proxyClientMaxBodySize: '50mb',
  },
};

export default nextConfig;
