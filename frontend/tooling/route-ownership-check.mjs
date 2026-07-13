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

/** Segment-aware equality: ':param' / '[param]' / '[...param]' all match any segment. */
function samePath(a, b) {
  const A = a.split('/').filter(Boolean);
  const B = b.split('/').filter(Boolean);
  if (A.length !== B.length) return false;
  return A.every((seg, i) => {
    const dyn = (s) => s.startsWith(':') || s.startsWith('[');
    return dyn(seg) || dyn(B[i]) ? true : seg === B[i];
  });
}

export function findCollisions() {
  const routes = appRoutes();
  const pub = publicPaths();
  const sources = configSources();
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
  return { routes, publicCount: pub.length, sources, collisions };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { routes, publicCount, sources, collisions } = findCollisions();
  console.log(`route-ownership: ${routes.length} app routes · ${publicCount} public files · ${sources.length} config sources`);
  if (collisions.length) {
    for (const c of collisions) console.error('COLLISION: ' + c);
    process.exit(1);
  }
  console.log('route-ownership: clean');
}
