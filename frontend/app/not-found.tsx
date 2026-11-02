import { connection } from 'next/server';

import NotFoundCard from './not-found-card';

export default async function NotFound() {
  // PC-J566: an unmatched URL under a signed-in prefix (`/home/x`, `/admin/x`)
  // gets proxy.ts's nonce CSP, but no route renders it, so Next serves this
  // page. Prerendered, its scripts carry no nonce and the enforced policy
  // blocks all of them. When the nonce build flag is on, render it per request
  // so Next stamps the request's nonce; `/_not-found` keeps its 404 status and
  // server HTML. Flag off (production) keeps the prerendered page.
  if (process.env.AVER_CSP_NONCE_REPORT_ONLY === '1') await connection();
  // The root layout loads no design tokens (route-group shells do), so an
  // unmatched URL rendered here without any `--av-*` values — an unstyled
  // page (U-14 / BL-03). Load the tokens the module CSS reads, as
  // global-error.tsx does.
  return <><link rel="stylesheet" href="/css/aver-design/tokens.css" /><NotFoundCard /></>;
}

// Allows the blocking request-time render above (cacheComponents otherwise
// requires a prerenderable shell); the same opt-out as the AuthedShell layouts.
export const instant = false;
