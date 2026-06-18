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

describe('W-2 — instructor nav item (aver-chrome)', () => {
  it('renders a hidden, href-less placeholder item (never 404s)', () => {
    const m = CHROME.match(/id="instructor-link"[^>]*>/);
    assert.ok(m, 'instructor-link element must exist');
    const tag = m[0];
    assert.match(tag, /\bhidden\b/, 'hidden by default');
    assert.match(tag, /aria-disabled="true"/, 'marked disabled');
    assert.doesNotMatch(tag, /href=/, 'NO href → cannot navigate/404 (placeholder until W-6)');
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
