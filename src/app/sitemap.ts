import type { MetadataRoute } from 'next';
import { blogPosts } from '@/lib/blog';
import { productBrand } from '@/lib/brand';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...['/', '/blog', '/pricing', '/terms', '/privacy'].map((path) => ({
      url: `${productBrand.canonicalUrl}${path === '/' ? '' : path}`,
    })),
    ...blogPosts.map((post) => ({
      url: `${productBrand.canonicalUrl}/blog/${post.slug}`,
      lastModified: post.publishedAt,
    })),
  ];
}
