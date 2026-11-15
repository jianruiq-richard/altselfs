import type { MetadataRoute } from 'next';
import { blogPosts } from '@/lib/blog';
import { productBrand } from '@/lib/brand';
import { isLegacyMarketingPath } from '@/lib/legacy-marketing-pages';
import { marketingPaths } from '@/lib/marketing/content';

export default function sitemap(): MetadataRoute.Sitemap {
  const primaryPaths = ['/pricing', '/agents', '/models', '/guidance', '/download'];
  return [
    ...['/', ...primaryPaths, '/contact', '/terms', '/privacy', ...marketingPaths.filter((path) => !primaryPaths.includes(path))].map((path) => ({
      url: `${productBrand.canonicalUrl}${path === '/' ? '' : path}`,
    })),
    ...blogPosts.filter((post) => !isLegacyMarketingPath(`/blog/${post.slug}`)).map((post) => ({
      url: `${productBrand.canonicalUrl}/blog/${post.slug}`,
      lastModified: post.publishedAt,
    })),
  ];
}
