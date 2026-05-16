/**
 * frontend/tests/vocab-source-link.test.mjs
 *
 * Sprint 10.8 — pin the shared `renderSourceLink` helper + its three
 * consumers (my-vocab, needs-review, pending-vocab).
 *
 * Why a dedicated sentinel:
 *   Pre-10.8 the "↗ nguồn" anchor was open-coded in 2/3 of the surfaces
 *   with byte-identical markup. Sprint 10.8 extracts a single helper
 *   in `_source-link.js`. This file pins:
 *
 *     1. The helper module exists, exports `renderSourceLink`, and
 *        applies the Andy Q1/Q2/Q3 contract (link when session_id
 *        truthy, empty string otherwise — session-deleted is covered
 *        transparently by the ON DELETE SET NULL on user_vocabulary.
 *        session_id, so the same gate handles both manual-add and
 *        session-deleted in one boolean).
 *     2. Each of the three consumer modules `import`s the helper and
 *        no longer ships its own open-coded copy. A future PR that
 *        forks the anchor markup back into an inline string fails
 *        here loudly.
 *     3. The href format stays /pages/result.html?id={session_id} —
 *        the same deep-link entry result.html already supports
 *        (validated by Sprint 10.4 pending panel).
 *
 * Test style is sentinel-string-match against the module source —
 * same pattern as vocab-module-loader.test.mjs and
 * pending-vocab.test.mjs. No DOM, no Node.js execution of the modules
 * (they import ES-module siblings that resolve at runtime in the
 * browser, not under bare `node --test`).
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const HELPER_SRC      = readFileSync(join(ROOT, 'js/vocab-modules/_source-link.js'), 'utf8');
const MY_VOCAB_SRC    = readFileSync(join(ROOT, 'js/vocab-modules/my-vocab.js'),     'utf8');
const NEEDS_REVIEW_SRC = readFileSync(join(ROOT, 'js/vocab-modules/needs-review.js'), 'utf8');
const PENDING_SRC     = readFileSync(join(ROOT, 'js/pending-vocab.js'),              'utf8');


describe('Sprint 10.8 — _source-link.js helper contract', () => {

  it('exports renderSourceLink', () => {
    assert.ok(
      /export\s+function\s+renderSourceLink\s*\(/.test(HELPER_SRC),
      '_source-link.js must `export function renderSourceLink(...)`.'
    );
  });

  it('gates rendering on truthy session_id', () => {
    // Andy Q2 + Q3 collapse into one boolean gate: render iff
    // session_id is set. Manual add → null. Session deleted →
    // ON DELETE SET NULL fired → null. Both hide the link.
    assert.ok(
      /const\s+sessionId\s*=\s*item\s*&&\s*item\.session_id/.test(HELPER_SRC),
      'Helper must read session_id from the item argument.',
    );
    assert.ok(
      /if\s*\(!sessionId\)\s*return\s+''\s*;/.test(HELPER_SRC),
      'Helper must return an empty string when session_id is falsy.',
    );
  });

  it('renders the anchor with /pages/result.html?id= deep-link', () => {
    // Sprint 10.4 already wired this entry point on result.html
    // (URLSearchParams `id`); Sprint 10.8 reuses it without any
    // server-side route changes.
    assert.ok(
      HELPER_SRC.includes('/pages/result.html?id='),
      'Helper must point at /pages/result.html?id=<session_id>.',
    );
    assert.ok(
      HELPER_SRC.includes('vocab-action vocab-action--source'),
      'Helper must apply the canonical .vocab-action--source class '
      + '(my-vocabulary.css Sprint 9.3 primitive).',
    );
    assert.ok(
      HELPER_SRC.includes('↗ nguồn'),
      'Helper must keep the Vietnamese label "↗ nguồn".',
    );
  });

  it('escapes session_id before interpolating into href', () => {
    // session_id is a UUID in practice, but defense-in-depth — the
    // helper carries its own _esc() so a malformed value can't break
    // out of the anchor attribute.
    assert.ok(
      /function\s+_esc\s*\(/.test(HELPER_SRC),
      'Helper must define a local _esc() so the href interpolation is escaped.',
    );
    assert.ok(
      HELPER_SRC.includes('_esc(sessionId)'),
      'Helper must call _esc(sessionId) when building the href.',
    );
  });
});


describe('Sprint 10.8 — three surfaces consume the helper', () => {

  it('my-vocab.js imports renderSourceLink from the helper', () => {
    assert.ok(
      /import\s*\{\s*renderSourceLink\s*\}\s+from\s+['"]\.\/_source-link\.js['"]/.test(MY_VOCAB_SRC),
      'my-vocab.js must `import { renderSourceLink } from "./_source-link.js"`.',
    );
  });

  it('my-vocab.js no longer ships an inline source-link anchor', () => {
    // Catch a future PR that forks the helper back into an inline
    // string. Pin the inline-anchor pattern that the helper replaced.
    assert.ok(
      !/`<a href="\/pages\/result\.html\?id=\$\{esc\(item\.session_id\)\}"/.test(MY_VOCAB_SRC),
      'my-vocab.js must use the renderSourceLink helper, not the inline anchor.',
    );
  });

  it('needs-review.js imports renderSourceLink from the helper', () => {
    assert.ok(
      /import\s*\{\s*renderSourceLink\s*\}\s+from\s+['"]\.\/_source-link\.js['"]/.test(NEEDS_REVIEW_SRC),
      'needs-review.js must `import { renderSourceLink } from "./_source-link.js"`.',
    );
  });

  it('needs-review.js no longer ships an inline source-link anchor', () => {
    assert.ok(
      !/`<a href="\/pages\/result\.html\?id=\$\{esc\(item\.session_id\)\}"/.test(NEEDS_REVIEW_SRC),
      'needs-review.js must use the renderSourceLink helper, not the inline anchor.',
    );
  });

  it('pending-vocab.js imports renderSourceLink from the helper', () => {
    // pending-vocab lives at /js/pending-vocab.js (not in vocab-modules/)
    // so its import path goes through the vocab-modules subdir.
    assert.ok(
      /import\s*\{\s*renderSourceLink\s*\}\s+from\s+['"]\.\/vocab-modules\/_source-link\.js['"]/.test(PENDING_SRC),
      'pending-vocab.js must import the helper from vocab-modules/_source-link.js.',
    );
  });

  it('pending-vocab.js renders the source link inside .pending-card__actions', () => {
    // Sprint 10.8 adds the source link to the third surface (it was
    // missing in Sprint 10.4). Spec smoke check #4 accepts the
    // self-referential link when pending items belong to the current
    // result page — the helper still emits the anchor; UX is OK.
    assert.ok(
      /renderSourceLink\s*\(\s*item\s*\)/.test(PENDING_SRC),
      'pending-vocab.js cardHtml() must call renderSourceLink(item).',
    );
    // Sentinel: the rendered string must land inside the pending-card
    // actions block, not as a free-floating fragment.
    const actionsMatch = PENDING_SRC.match(/<div class="pending-card__actions">[\s\S]*?<\/div>/);
    assert.ok(
      actionsMatch && /\$\{sourceLink\}|renderSourceLink/.test(actionsMatch[0]),
      'sourceLink must be interpolated inside .pending-card__actions.',
    );
  });
});
