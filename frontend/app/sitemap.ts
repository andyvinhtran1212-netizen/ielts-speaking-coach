import type { MetadataRoute } from 'next';

import { getPublicJson } from '@/lib/backend';
import { getHome } from '@/lib/grammar-api';
import { buildPublicSitemap, LIBRARY_SAMPLE_INDEX_PATH } from '@/lib/public-sitemap-model.mjs';

/** Published Writing sample sets for the sitemap (LIBRARY-0061 FR-062); unreadable → null, skipped. */
async function writingSampleIndex(): Promise<unknown> {
  try {
    return await getPublicJson(LIBRARY_SAMPLE_INDEX_PATH);
  } catch {
    return null;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const writingSamples = await writingSampleIndex();
  try {
    return buildPublicSitemap(await getHome(), { writingSamples }) as MetadataRoute.Sitemap;
  } catch {
    // Metadata must remain available during a temporary backend outage. The
    // cache-backed Grammar pages still fail honestly through their boundary;
    // sitemap falls back to stable public roots rather than returning 500.
    return buildPublicSitemap(null, { writingSamples }) as MetadataRoute.Sitemap;
  }
}
