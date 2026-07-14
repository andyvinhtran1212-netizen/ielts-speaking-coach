#!/usr/bin/env node
// Compiled route-ownership graph (plan §8.2 / ADR-002, Phase 1).
//
// Detects ownership collisions between the three routing sources:
//   1. App Router routes (app/**/page.tsx | route.ts)
//   2. public/ files (legacy tree — served at their literal paths)
//   3. next.config.ts rewrite/redirect SOURCES (legacy-owned clean URLs)
//
// The contract this enforces: a canonical URL has exactly ONE owner. Cutting
// a route over to Next requires REMOVING its legacy rewrite in the same
// change (atomic transfer) — a forgotten removal fails here instead of
// silently shadowing the new app route (beforeFiles wins over app routes).
//
// Exits 1 and prints collisions; exits 0 when the graph is clean.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function appRoutes() {
  const routes = [];
  const walk = (dir, urlSegs) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name.startsWith('_')) continue;              // private folders
        const seg = e.name.startsWith('(') && e.name.endsWith(')')
          ? null                                            // route group
          : e.name;
        walk(path.join(dir, e.name), seg ? [...urlSegs, seg] : urlSegs);
      } else if (/^(page|route)\.(tsx|ts)$/.test(e.name)) {
        routes.push('/' + urlSegs.join('/'));
      }
    }
  };
  walk(path.join(FRONTEND, 'app'), []);
  return routes;
}

function publicPaths() {
  const files = [];
  const walk = (dir, prefix) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${prefix}/${e.name}`;
      if (e.isDirectory()) walk(path.join(dir, e.name), p);
      else files.push(p);
    }
  };
  walk(path.join(FRONTEND, 'public'), '');
  return files;
}

function configSources() {
  const src = readFileSync(path.join(FRONTEND, 'next.config.ts'), 'utf8');
  return Array.from(src.matchAll(/\{ source: '([^']+)'/g)).map((m) => m[1]);
}

/** AUDIT F7 (2026-07-14): pattern OVERLAP, not same-length equality.
 * The old samePath required equal segment COUNTS, so catch-alls were blind
 * spots: `/grammar/[...slug]` vs source `/grammar/:category/:slug` never
 * matched (1 vs 2 segments) even though both own the same URLs. Catch-alls
 * (`[...p]`, `[[...p]]`, `:p*`, `:p+`) now consume any remaining segments
 * (≥1, or ≥0 for the optional forms). Two patterns collide when at least one
 * concrete URL satisfies both. */
function isCatchAll(s) {
  return /^\[\[?\.\.\./.test(s) || /^:[^/]+[*+]$/.test(s);
}
function isOptionalCatchAll(s) {
  return /^\[\[\.\.\./.test(s) || /^:[^/]+\*$/.test(s);
}
export function samePath(a, b) {
  const A = a.split('/').filter(Boolean);
  const B = b.split('/').filter(Boolean);
  const dyn = (s) => s.startsWith(':') || s.startsWith('[');
  const rec = (i, j) => {
    const aDone = i >= A.length;
    const bDone = j >= B.length;
    if (aDone && bDone) return true;
    // A catch-all is always the LAST segment of its pattern (Next/vercel
    // both enforce this) — it matches iff the other side has enough left.
    if (!aDone && isCatchAll(A[i])) {
      return B.length - j >= (isOptionalCatchAll(A[i]) ? 0 : 1);
    }
    if (!bDone && isCatchAll(B[j])) {
      return A.length - i >= (isOptionalCatchAll(B[j]) ? 0 : 1);
    }
    if (aDone || bDone) return false;
    if (dyn(A[i]) || dyn(B[j]) || A[i] === B[j]) return rec(i + 1, j + 1);
    return false;
  };
  return rec(0, 0);
}

function collisionsFor(routes, pub, sources) {
  const collisions = [];
  for (const r of routes) {
    for (const p of pub) {
      if (samePath(r, p)) collisions.push(`app route ${r} collides with public file ${p}`);
    }
    for (const s of sources) {
      if (samePath(r, s)) {
        collisions.push(
          `app route ${r} is SHADOWED by config source ${s} — remove the legacy rule in the same change (atomic cutover, plan §8.2)`,
        );
      }
    }
  }
  return collisions;
}

export function findCollisions() {
  const routes = appRoutes();
  const pub = publicPaths();
  const sources = configSources();
  return { routes, publicCount: pub.length, sources, collisions: collisionsFor(routes, pub, sources) };
}

// ── AUDIT F7 (2026-07-14): manifest-based verification ─────────────────
// The source walk above is a heuristic — it re-derives what the compiler
// WILL do from file names. The audit's point: the artifact that actually
// routes production traffic is .next/routes-manifest.json, so after a build
// the check must run against THAT truth. Drift between the two means the
// heuristic has a blind spot (parallel/intercepting routes, compiler
// changes) — fail loudly, don't guess.
const MANIFEST_INTERNAL = new Set(['/_global-error', '/_not-found']);

export function manifestRoutes(manifestPath = path.join(FRONTEND, '.next', 'routes-manifest.json')) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return [...(manifest.staticRoutes || []), ...(manifest.dynamicRoutes || [])]
    .map((r) => r.page)
    .filter((p) => !MANIFEST_INTERNAL.has(p));
}

export function findManifestProblems(manifestPath) {
  const compiled = manifestRoutes(manifestPath);
  const source = appRoutes();
  const problems = [];
  for (const r of compiled) {
    if (!source.includes(r)) {
      problems.push(`manifest route ${r} is INVISIBLE to the source walk — the heuristic has a blind spot; fix appRoutes()`);
    }
  }
  for (const r of source) {
    if (!compiled.includes(r)) {
      problems.push(`source-derived route ${r} did not compile into the manifest — stale expectation`);
    }
  }
  problems.push(...collisionsFor(compiled, publicPaths(), configSources()));
  return { compiled, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { routes, publicCount, sources, collisions } = findCollisions();
  console.log(`route-ownership: ${routes.length} app routes · ${publicCount} public files · ${sources.length} config sources`);
  if (collisions.length) {
    for (const c of collisions) console.error('COLLISION: ' + c);
    process.exit(1);
  }
  console.log('route-ownership: clean');

  if (process.argv.includes('--manifest')) {
    let result;
    try {
      result = findManifestProblems();
    } catch (e) {
      console.error('route-ownership --manifest: cannot read .next/routes-manifest.json — run `next build` first. ' + e.message);
      process.exit(1);
    }
    console.log(`route-ownership --manifest: ${result.compiled.length} compiled routes`);
    if (result.problems.length) {
      for (const p of result.problems) console.error('MANIFEST: ' + p);
      process.exit(1);
    }
    console.log('route-ownership --manifest: clean (compiled truth matches source heuristic, zero collisions)');
  }
}
