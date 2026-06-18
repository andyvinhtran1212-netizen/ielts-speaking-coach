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
