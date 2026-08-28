import type { MetadataRoute } from 'next';
import { productBrand } from '@/lib/brand';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin/', '/investor/', '/avatar/', '/chat/'],
    },
    sitemap: `${productBrand.canonicalUrl}/sitemap.xml`,
  };
}
