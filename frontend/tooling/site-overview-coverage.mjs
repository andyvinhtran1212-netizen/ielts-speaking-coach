// Documentation sentinel, not a compiled routing or runtime-parity verifier.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { appPageRoute, NON_PRODUCT_APP_PAGE_ROUTES } from './app-route-inventory.mjs';
import { LEGACY_RETIREMENT_PATHS } from './legacy-url-paths.mjs';
import { canonicalNextRouteForLegacy } from './legacy-url-mapping.mjs';

export function collectOverviewPages(frontendRoot) {
  if (!existsSync(path.join(frontendRoot, 'app'))) throw new Error('App Router directory missing: ' + frontendRoot);
  const sources = [];
  function walk(relative = '') {
    for (const entry of readdirSync(path.join(frontendRoot, 'app', relative), { withFileTypes: true })) {
      if (entry.name.startsWith('_')) continue;
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Unsupported App Router symlink: ${file}`);
      if (entry.isDirectory()) {
        // Do not silently guess URLs for conventions beyond the shared mapper.
        if (/^\(\.{1,3}\)/.test(entry.name) || entry.name.includes('%')) {
          throw new Error(`Unsupported App Router segment: ${file}`);
        }
        walk(file);
      } else if (/^page\.(jsx|js)$/.test(entry.name)) {
        throw new Error(`Extend the shared route inventory before adding ${file}`);
      } else if (/^page\.(tsx|ts)$/.test(entry.name)) {
        const route = appPageRoute(file);
        if (!route) throw new Error(`Unmapped App Router page: ${file}`);
        if (!NON_PRODUCT_APP_PAGE_ROUTES.includes(route)) sources.push({ file, route });
      }
    }
  }
  walk();
  const routes = [...new Set(sources.map(({ route }) => route))].sort();
  if (!routes.length) throw new Error('No product App Router pages found');
  return { routes, sources };
}

function unfencedLines(markdown) {
  let fence = null;
  return String(markdown).split(/\r?\n/).filter((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return false;
    }
    return fence === null;
  });
}

export function inspectOverview(markdown, routes) {
  const routeSet = new Set(routes);
  if (!routeSet.size) throw new Error('Cannot measure an empty route inventory');
  const lines = unfencedLines(markdown);
  let inPageMap = false;
  const references = new Set();
  const invalidReferences = [];
  for (const line of lines) {
    if (/^## 4\./.test(line)) inPageMap = true;
    else if (/^##\s/.test(line)) inPageMap = false;
    if (!inPageMap || !/^\|/.test(line)) continue;
    const columns = line.split('|');
    const cell = columns[1].trim();
    if (/^(?:Page(?:\(s\))?|[-:\s]+)$/.test(cell)) continue;
    if (!columns[2]?.trim() || !columns[3]?.trim()) {
      invalidReferences.push(`Missing audience/purpose: ${cell}`);
    }
    const codes = [...cell.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
    if (!codes.length) invalidReferences.push(cell || '(empty page cell)');
    for (const code of codes) {
      const route = code.split(/[?#]/)[0];
      if (!route.startsWith('/') || !routeSet.has(route)) invalidReferences.push(code);
      else references.add(route);
    }
  }
  // Historical HTML mentions may remain in prose, but their durable redirect
  // identity and current owner must exist. They never inflate native coverage.
  const legacyReferences = [...lines.join('\n').matchAll(/`([^`\n]+)`/g)]
    .map((match) => match[1].replace(/^\//, '').replace(/^frontend\/(?:public\/)?/, ''))
    .filter((code) => /^(?:pages\/[A-Za-z0-9_/-]+|[A-Za-z0-9_][A-Za-z0-9_.-]*)\.html$/.test(code))
    .map((code) => `/${code}`);
  const knownLegacy = new Set(LEGACY_RETIREMENT_PATHS);
  const deadLegacyReferences = [...new Set(legacyReferences)].filter((legacy) =>
    !knownLegacy.has(legacy) || !routeSet.has(canonicalNextRouteForLegacy(legacy)));
  const missing = [...routeSet].filter((route) => !references.has(route)).sort();
  return {
    documented: [...references].sort(),
    invalidReferences: [...new Set(invalidReferences)].sort(),
    deadLegacyReferences,
    missing,
    coverage: references.size / routeSet.size,
  };
}
