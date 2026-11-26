// PUBLICSITE-0059 FR-026 (G05-T23): operational flags and contact info share
// the backend's 60-second cache. Deduplicate reads within a render without
// retaining a previous flag state in the public content cache.
import 'server-only';

import { cache } from 'react';
import { ABORT_MS, API_BASE } from '@/lib/backend';
import { emptySiteInfo, normalizeSiteInfo, type SiteInfo } from '@/lib/site-info-model.mjs';

export type { ContactRow, SiteContact, SiteEnroll, SiteInfo } from '@/lib/site-info-model.mjs';

export const getSiteInfo = cache(async (): Promise<SiteInfo> => {
  try {
    const response = await fetch(`${API_BASE}/api/public/site-info`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(ABORT_MS),
    });
    if (response.ok) return normalizeSiteInfo(await response.json());
  } catch {
    // A failed or malformed response keeps the public feature flags off.
  }
  return emptySiteInfo();
});
