// PUBLICSITE-0059 FR-026 (G05-T23): operational flags and contact info share
// the backend's 60-second cache. Deduplicate reads within a render without
// retaining a previous flag state in the public content cache.
import 'server-only';

import { cache } from 'react';
import { getPublicJson } from '@/lib/backend';
import { emptySiteInfo, normalizeSiteInfo, type SiteInfo } from '@/lib/site-info-model.mjs';

export type { ContactRow, SiteContact, SiteEnroll, SiteInfo } from '@/lib/site-info-model.mjs';

export const getSiteInfo = cache(async (): Promise<SiteInfo> => {
  try {
    return normalizeSiteInfo(await getPublicJson('/api/public/site-info'));
  } catch {
    // A failed or malformed response keeps the public feature flags off.
  }
  return emptySiteInfo();
});
