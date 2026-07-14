// N/N−1 consumer contract — profile mutation pilot (ADR-009, Pilot Entry
// checklist). Pins that the LEGACY profile client (public/pages/profile.html)
// and the NEXT profile client (app/(authed)/profile/profile-behavior.tsx) are
// INTERCHANGEABLE consumers of the SAME /auth/profile contract, and that the
// backend accepts/returns everything BOTH need. That is what makes the profile
// cutover rollback-safe: after a frontend rollback (Next → legacy) the legacy
// client still works against backend HEAD, and a backend rollback (N → N−1)
// still serves the Next client — because neither side sends/reads anything the
// other (or the backend) doesn't.
//
// The LIVE half — running each client's exact payload against the staging
// backend HEAD — is tests/staging-e2e/nn1-profile-consumer.spec.js.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(FRONTEND);
const read = (...p) => readFileSync(path.join(...p), 'utf8');

const LEGACY = read(FRONTEND, 'public', 'pages', 'profile.html');
const NEXT = read(FRONTEND, 'app', '(authed)', 'profile', 'profile-behavior.tsx');
const BACKEND = read(REPO, 'backend', 'routers', 'auth.py');

// ── Extract the PATCH payload keys from an object literal `... payload ... = {`
function writeKeys(src) {
  const m = src.match(/payload[^=]*=\s*\{([\s\S]*?)\};/);
  assert.ok(m, 'could not locate the save payload literal');
  return new Set(
    [...m[1].matchAll(/^\s*([a-z_]+)\s*:/gm)].map((x) => x[1]),
  );
}

// ── Backend ProfileUpdate accepted fields
function backendAccepted() {
  const m = BACKEND.match(/class ProfileUpdate\(BaseModel\):([\s\S]*?)\n\n/);
  assert.ok(m, 'ProfileUpdate model not found');
  return new Set([...m[1].matchAll(/^\s{4}([a-z_]+):/gm)].map((x) => x[1]));
}

// ── Backend GET /auth/profile response keys
function backendResponse() {
  const start = BACKEND.indexOf('async def get_profile');
  const slice = BACKEND.slice(start, BACKEND.indexOf('async def', start + 10));
  // the return dict + the nested stats keys
  return new Set([...slice.matchAll(/"([a-z_]+)":/g)].map((x) => x[1]));
}

const legacyWrite = writeKeys(LEGACY);
const nextWrite = writeKeys(NEXT);
const accepted = backendAccepted();
const response = backendResponse();

test('both clients send the IDENTICAL PATCH payload shape (interchangeable consumers)', () => {
  assert.deepStrictEqual(
    [...legacyWrite].sort(), [...nextWrite].sort(),
    'legacy and Next must PATCH the same fields — a mismatch means a frontend rollback changes the write contract',
  );
  // sanity: the known contract
  assert.deepStrictEqual([...nextWrite].sort(),
    ['display_name', 'exam_date', 'self_level', 'target_band', 'weekly_goal']);
});

test('every field both clients WRITE is accepted by the backend (forward compat)', () => {
  for (const k of new Set([...legacyWrite, ...nextWrite])) {
    assert.ok(accepted.has(k), `backend PATCH /auth/profile must accept "${k}" (a client sends it)`);
  }
});

test('every field the clients READ is returned by the backend GET (no-removal — ADR-009 §1)', () => {
  // The union of profile fields both render functions consume. Removing any of
  // these from the backend response would break a still-deployed client during
  // the rollback window.
  const readNeeded = [
    'display_name', 'email', 'avatar_url', 'target_band', 'exam_date',
    'self_level', 'weekly_goal', 'joined_at', 'stats',
    'total_sessions', 'avg_band', // nested under stats
  ];
  for (const k of readNeeded) {
    assert.ok(response.has(k), `backend GET /auth/profile must return "${k}" (a client reads it)`);
    assert.ok(LEGACY.includes(k) || k === 'total_sessions' || k === 'avg_band',
      `legacy client should reference "${k}"`);
  }
});

test('the cutover redirect keeps the legacy consumer reachable on rollback', () => {
  // ADR-009 rollback-safety: the legacy page file must stay on disk and the
  // redirect must be TEMPORARY so a rolled-back /profile (404) does not strand
  // clients that cached a permanent redirect.
  const cfg = read(FRONTEND, 'next.config.ts');
  assert.match(cfg, /source: '\/pages\/profile\.html', destination: '\/profile', permanent: false/,
    'legacy profile path must consolidate via a TEMPORARY redirect (rollback-safe)');
});
