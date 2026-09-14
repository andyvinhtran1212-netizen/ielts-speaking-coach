import type { MetadataRoute } from 'next';

import { getHome } from '@/lib/grammar-api';
import { buildPublicSitemap } from '@/lib/public-sitemap-model.mjs';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    return buildPublicSitemap(await getHome()) as MetadataRoute.Sitemap;
  } catch {
    // Metadata must remain available during a temporary backend outage. The
    // cache-backed Grammar pages still fail honestly through their boundary;
    // sitemap falls back to stable public roots rather than returning 500.
    return buildPublicSitemap(null) as MetadataRoute.Sitemap;
  }
}
