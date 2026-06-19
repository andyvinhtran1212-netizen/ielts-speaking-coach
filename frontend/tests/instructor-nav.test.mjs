/**
 * W-2 — role-gated "Trang Instructor" nav item in <aver-chrome>.
 *
 * Static source contract (matches the repo's chrome-test convention):
 *   - the item exists, is hidden by default, and has NO href (disabled
 *     placeholder → can never 404; the destination page lands in W-6);
 *   - setRole() un-hides ONLY for role 'instructor' or 'admin';
 *   - setUser() forwards an optional role to setRole();
 *   - the canonical page (speaking.html) passes the /auth/me role through.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHROME = readFileSync(join(__dirname, '..', 'js', 'components', 'aver-chrome.js'), 'utf8');
const SPEAKING = readFileSync(join(__dirname, '..', 'pages', 'speaking.html'), 'utf8');

describe('W-6b — instructor nav item (aver-chrome)', () => {
  it('renders a hidden, role-gated link to the instructor area', () => {
    const m = CHROME.match(/<a[^>]*id="instructor-link"[^>]*>/);
    assert.ok(m, 'instructor-link <a> element must exist');
    const tag = m[0];
    assert.match(tag, /\bhidden\b/, 'hidden by default (role-gated)');
    // W-6b: now a REAL link to the instructor area (no longer a placeholder).
    assert.match(tag, /href="\/pages\/instructor\/index\.html"/, 'links to the instructor area');
  });

  it('setRole un-hides ONLY for instructor or admin', () => {
    assert.match(CHROME, /setRole\(role\)/, 'setRole method exists');
    // the gate must accept exactly instructor + admin
    assert.match(
      CHROME,
      /_role === 'instructor' \|\| this\._role === 'admin'/,
      'role gate = instructor || admin (admin ⊃ instructor)',
    );
    // show/hide toggling present
    assert.match(CHROME, /removeAttribute\('hidden'\)/);
    assert.match(CHROME, /setAttribute\('hidden', ''\)/);
  });

  it('setUser forwards an optional role to setRole', () => {
    assert.match(CHROME, /setUser\(\{ name, initials, email, role \}/);
    assert.match(CHROME, /if \(role !== undefined\) this\.setRole\(role\)/);
  });

  it('applies role on connect (pre-connect setRole survives upgrade)', () => {
    assert.match(CHROME, /this\._applyRole\(\);/);
  });

  it('speaking.html passes the /auth/me role into setUser', () => {
    assert.match(SPEAKING, /chrome\.setUser\(\{ name: displayName, role: user\.role \}\)/);
  });
});


// ── Fix-2 (D-B) — chrome auto-resolves role on EVERY page (not just speaking) ──
//
// Convention note: the repo's chrome tests are static-source contracts (the
// frontend stays zero-dependency — no jsdom). These pin the auto-role-resolution
// behaviour by source shape; the live visible/hidden behaviour is exercised by
// Andy's dogfood (instructor sees the link on home; a normal user does not).

describe('Fix-2 (D-B) — aver-chrome auto-resolves role from /auth/me', () => {
  it('has a _resolveRole method that fetches /auth/me', () => {
    assert.match(CHROME, /_resolveRole\s*\(\s*token\s*\)/, '_resolveRole(token) method exists');
    assert.match(CHROME, /fetch\(base \+ '\/auth\/me'/, 'fetches the authoritative /auth/me');
    assert.match(CHROME, /Authorization: 'Bearer ' \+ token/, 'sends the session bearer token');
  });

  it('uses a raw fetch, NOT window.api.get (which would redirect to /login on 401)', () => {
    // The role probe must never bounce the page to login — a raw fetch lets a
    // 401/stale-token fall through to the fail-closed path below.
    assert.doesNotMatch(CHROME, /api\.get\(\s*['"`]\/auth\/me/, 'must not use api.get for the role probe');
  });

  it('resolves role then calls setRole (non-instructor / null → stays hidden)', () => {
    assert.match(CHROME, /role = \(me && me\.role\) \|\| null/, 'reads role off the /auth/me payload');
    assert.match(CHROME, /this\.setRole\(role\)/, 'feeds the resolved role into the existing gate');
  });

  it('no double-fetch — skips when a page already set the role', () => {
    // _userOverride short-circuits the whole auto path (speaking.html), and the
    // _role!==null guard covers a bare setRole() — so /auth/me is fetched at most
    // once, and never on the page-authoritative path.
    assert.match(CHROME, /if \(this\._role !== null\) return;/, 'guards against double-fetch / race');
  });

  it('fail-closed — non-OK response or error leaves the link hidden, never throws', () => {
    assert.match(CHROME, /if \(resp && resp\.ok\)/, 'only trusts an OK response');
    assert.match(CHROME, /catch\s*\{[\s\S]*?return;[\s\S]*?\}/, 'swallows network/parse errors (fail-closed)');
    // logged-out path: no token → return before any fetch (link stays hidden).
    assert.match(CHROME, /if \(!token\) return;/, 'unauthenticated → no fetch, link hidden');
  });

  it('the auto-populate path drives role resolution with the session token', () => {
    assert.match(
      CHROME,
      /await this\._resolveRole\(session\.access_token\)/,
      'tick() resolves role only after a real session is in hand',
    );
  });
});


// ── W-6b-1: FE cross-tenant grep-gate — instructor pages must NEVER call /admin/* ──

import { readdirSync, statSync } from 'node:fs';

function _walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(..._walk(p));
    else out.push(p);
  }
  return out;
}

describe('W-6b-1 — instructor shell never calls /admin/*', () => {
  const FILES = [
    ..._walk(join(__dirname, '..', 'pages', 'instructor')),
    join(__dirname, '..', 'js', 'instructor-app.js'),
    join(__dirname, '..', 'js', 'instructor-grade.js'),
  ];
  // a quoted admin-path literal in a fetch/api call (',",` then /admin) = cross-tenant leak
  const ADMIN_CALL = /['"`]\/admin\//;
  // W-6b-3: the instructor must NEVER mutate AI feedback → no admin_edits_json anywhere
  const AI_EDIT = /admin_edits_json/;

  for (const f of FILES) {
    it(`${f.split('/frontend/')[1]} has zero quoted /admin/ call literals`, () => {
      const src = readFileSync(f, 'utf8');
      const m = src.match(ADMIN_CALL);
      assert.equal(m, null, `cross-tenant leak: ${f} references ${m && m[0]} — must use /instructor/*`);
    });
    it(`${f.split('/frontend/')[1]} never references admin_edits_json (AI immutable)`, () => {
      const src = readFileSync(f, 'utf8');
      assert.equal(src.match(AI_EDIT), null, `${f} touches admin_edits_json — instructor must NOT edit AI feedback`);
    });
  }
});
