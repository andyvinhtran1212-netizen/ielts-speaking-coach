// PC-J566 / SA-1029-CSP1 F1 (b): every URL pattern under the proxy's nonce
// prefixes that an app/ route answers, read from the source tree when Next
// reads next.config.ts's env (so it is rebuilt with every build and cannot
// drift from app/). public/ has no file under these prefixes
// (tests/csp-nonce-enforce.test.mjs keeps it so).
// The proxy gives the nonce policy only to URLs matching one of these; any
// other prefixed URL is the static root 404 and keeps the public baseline.
// tooling/verify-csp-nonce-404-flow.mjs compares it with the compiled
// .next/routes-manifest.json, the table Next actually routes with.
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { nonceRouteAllowed } from './content-security-policy.mjs';

const ROUTE_FILE = /^(?:page|route)\.tsx?$/;

function walk(dir, visit, rel = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const next = [...rel, entry.name];
    if (entry.isDirectory()) walk(path.join(dir, entry.name), visit, next);
    else visit(next);
  }
}

/** App Router URL pattern for a page/route file, or null if it is not one. */
export function appRoutePattern(parts) {
  if (!ROUTE_FILE.test(parts.at(-1) ?? '')) return null;
  const dirs = parts.slice(0, -1);
  if (dirs.some((segment) => segment.startsWith('_'))) return null;
  // Intercepting routes have no plain-path equivalent here; fail the build
  // rather than guess, so a new one is added here deliberately.
  const intercepting = dirs.find((segment) => /^\(\.{1,3}\)/.test(segment));
  if (intercepting) throw new Error(`nonce-route-table: unsupported intercepting route segment ${intercepting}`);
  const segments = dirs.filter((segment) => !segment.startsWith('@')
    && !(segment.startsWith('(') && segment.endsWith(')')));
  return `/${segments.join('/')}`;
}

// The proxy compares static segments with the URL as sent. A name that a URL
// must percent-encode would never compare equal, so refuse it at build time.
function assertPlainSegments(route) {
  const odd = route.split('/').slice(1).find((segment) => !/^\[/.test(segment) && encodeURIComponent(segment) !== segment);
  if (odd !== undefined) throw new Error(`nonce-route-table: ${route} has a segment URLs percent-encode (${odd})`);
  return route;
}

/** Sorted route patterns under the nonce prefixes (pages and route handlers). */
export function collectNonceRoutes(frontendDir) {
  const routes = new Set();
  walk(path.join(frontendDir, 'app'), (parts) => {
    const route = appRoutePattern(parts);
    if (route && nonceRouteAllowed(route)) routes.add(assertPlainSegments(route));
  });
  if (routes.size === 0) throw new Error('nonce-route-table: no route found under the nonce prefixes');
  return [...routes].sort();
}
