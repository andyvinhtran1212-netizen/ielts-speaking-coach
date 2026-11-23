// PUBLICSITE-0059 FR-026 (G05-T23): the server read of GET /api/public/site-info.
//
// One read per page through the shared public layer (`getPublicJson`: its
// abort budget and cache life), so a page with several contact blocks costs
// one request. Any failure (backend down, 404 before the route ships, bad
// JSON, timeout) gives every field null/false: the contact block then links
// to /contact and the paused features stay off. A thrown read is not cached.
import 'server-only';

import { getPublicJson } from '@/lib/backend';
import { emptySiteInfo, normalizeSiteInfo, type SiteInfo } from '@/lib/site-info-model.mjs';

export type { ContactRow, SiteContact, SiteEnroll, SiteInfo } from '@/lib/site-info-model.mjs';

export async function getSiteInfo(): Promise<SiteInfo> {
  try {
    return normalizeSiteInfo(await getPublicJson('/api/public/site-info'));
  } catch {
    return emptySiteInfo();
  }
}
