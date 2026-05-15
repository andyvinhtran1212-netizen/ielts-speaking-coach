/**
 * frontend/tests/pending-vocab.test.mjs
 *
 * Sprint 10.4 — pin the capture confirmation panel contract.
 *
 * Pattern matches vocab-module-loader.test.mjs and
 * my-vocab-optimistic-mastery.test.mjs — sentinel-style string
 * assertions against the module source so a regression that drops
 * the optimistic fade, the empty-list early-return, or the
 * bulk-confirm flow fails here loudly.
 *
 * Surfaces under test:
 *   1. Module exports mount(container, opts) and the result.html
 *      inline script invokes it after the result data loads.
 *   2. Empty pending list → panel stays hidden (no empty-state UI).
 *   3. Each card has Keep + Drop buttons; "Giữ tất cả" lives in the
 *      panel header.
 *   4. Keep/Drop use optimistic fade before the POST.
 *   5. Network failure path restores the card and shows flashToast.
 *   6. Vietnamese copy strings present (Giữ, Bỏ, Giữ tất cả, the
 *      24h auto-commit notice).
 *   7. result.html wires the dynamic import to the pending-vocab
 *      mount target.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(__dirname, '..', 'js', 'pending-vocab.js');
const RESULT_HTML_PATH = join(__dirname, '..', 'pages', 'result.html');
const CSS_PATH = join(__dirname, '..', 'css', 'result.css');

const MODULE_SRC = readFileSync(MODULE_PATH, 'utf8');
const RESULT_HTML = readFileSync(RESULT_HTML_PATH, 'utf8');
const RESULT_CSS = readFileSync(CSS_PATH, 'utf8');


describe('Sprint 10.4 — pending vocab module surface', () => {

  it('exports mount(container, opts)', () => {
    assert.ok(
      /export\s+async\s+function\s+mount\s*\(\s*container\s*,\s*opts/.test(MODULE_SRC),
      'pending-vocab.js must export async mount(container, opts).',
    );
  });

  it('empty pending list short-circuits — no empty-state UI', () => {
    // Andy spec § 8: "If pending list empty: skip section entirely
    // (don't render empty state)". Pin via the array-length guard.
    assert.ok(
      MODULE_SRC.includes('items.length === 0'),
      'mount() must short-circuit on items.length === 0.',
    );
  });

  it('renders Keep + Drop + Keep-all controls', () => {
    assert.ok(
      MODULE_SRC.includes('data-action="keep"') &&
      MODULE_SRC.includes('data-action="drop"') &&
      MODULE_SRC.includes('data-action="keep-all"'),
      'Per-card keep/drop AND batch keep-all actions must be wired.',
    );
  });

  it('Vietnamese copy strings present (no English bleed)', () => {
    assert.ok(MODULE_SRC.includes('Từ vựng mới ghi nhận'),
      'Section title "Từ vựng mới ghi nhận" must appear.');
    assert.ok(MODULE_SRC.includes('Giữ tất cả'),
      'Batch button label "Giữ tất cả" must appear.');
    assert.ok(MODULE_SRC.includes('>Giữ<'),
      'Per-card "Giữ" label must appear.');
    assert.ok(MODULE_SRC.includes('>Bỏ<'),
      'Per-card "Bỏ" label must appear.');
    assert.ok(MODULE_SRC.includes('Tự động lưu sau 24h'),
      'Auto-commit notice text must appear.');
  });

  it('optimistic update: fade card before awaiting POST', () => {
    // Pattern: fadeCard(card) is called BEFORE `await apiJson` so the
    // UI flips synchronously. Pin via textual order in keepItem.
    const keepBlock = _extractFunctionBody('async function keepItem');
    const fadeIdx = keepBlock.indexOf('fadeCard(card)');
    const awaitIdx = keepBlock.indexOf('await apiJson');
    assert.ok(fadeIdx !== -1, 'keepItem must fade the card.');
    assert.ok(awaitIdx !== -1, 'keepItem must POST confirm.');
    assert.ok(
      fadeIdx < awaitIdx,
      'Optimistic fade must run BEFORE awaiting the POST.',
    );
  });

  it('rollback path restores card and shows flashToast on failure', () => {
    const keepBlock = _extractFunctionBody('async function keepItem');
    assert.ok(
      keepBlock.includes('restoreCard(card)'),
      'keepItem catch branch must restore the faded card.',
    );
    assert.ok(
      /flashToast\(/.test(keepBlock) && keepBlock.includes("'error'"),
      'keepItem catch branch must show an error toast.',
    );
    // Symmetry: drop path follows the same pattern.
    const dropBlock = _extractFunctionBody('async function dropItem');
    assert.ok(
      dropBlock.includes('restoreCard(card)') && /flashToast\(/.test(dropBlock),
      'dropItem must also rollback + toast on failure.',
    );
  });

  it('bulk-confirm posts the visible IDs in one batch', () => {
    const block = _extractFunctionBody('async function keepAll');
    assert.ok(
      block.includes("/pending/bulk-confirm"),
      'keepAll must POST to /pending/bulk-confirm.',
    );
    assert.ok(
      block.includes('ids: ids'),
      'keepAll must send the IDs payload.',
    );
    // All cards fade together before the await.
    assert.ok(
      block.indexOf('cards.forEach(fadeCard)') < block.indexOf('await apiJson'),
      'keepAll must fade all cards before awaiting the bulk POST.',
    );
  });
});


describe('Sprint 10.4 — result.html integration', () => {

  it('result.html ships the pending-vocab-mount container', () => {
    assert.ok(
      RESULT_HTML.includes('id="pending-vocab-mount"'),
      'result.html must expose the mount target div.',
    );
    assert.ok(
      /id="pending-vocab-mount"[^>]*\bclass="[^"]*\bhidden\b/.test(RESULT_HTML),
      'Mount target must start hidden — module unhides on non-empty fetch.',
    );
  });

  it('result.html dynamically imports pending-vocab.js after load', () => {
    assert.ok(
      RESULT_HTML.includes("import('../js/pending-vocab.js')"),
      'result.html inline script must dynamic-import the module.',
    );
    assert.ok(
      RESULT_HTML.includes('mod.mount('),
      'The import .then(...) must invoke mount().',
    );
  });

  it('result.css ships the .pending-panel styling', () => {
    assert.ok(
      RESULT_CSS.includes('.pending-panel'),
      'result.css must style .pending-panel.',
    );
    assert.ok(
      RESULT_CSS.includes('.pending-card--leaving'),
      'result.css must define the fade-out transition class.',
    );
  });
});


describe('Sprint 10.4.1-hotfix — pending vocab light-mode contrast pins', () => {

  // Bug 1 regression pin. The initial Sprint 10.4 CSS put the panel on
  // `--av-surface-card` (= #FFFFFF light) AND the cards on
  // `--av-surface-elevated` (also #FFFFFF light) — cards rendered
  // invisible because parent + child shared the same surface. Sprint
  // 10.4.1-hotfix lifts the panel to `--av-surface-sunken` (light grey
  // in light, deeper navy in dark) so cards on `--av-surface-card`
  // visibly elevate. If a future PR swaps these tokens back the
  // assertions below trip.

  function _pendingRule(selector) {
    // Extract the body of the first `selector { ... }` rule from result.css
    const m = RESULT_CSS.match(
      new RegExp(`${selector.replace(/\./g, '\\.')}\\s*\\{[^}]*\\}`),
    );
    return m ? m[0] : '';
  }

  it('.pending-panel uses --av-surface-sunken (lifts off page surface)', () => {
    const rule = _pendingRule('.pending-panel');
    assert.ok(
      rule.includes('--av-surface-sunken'),
      '.pending-panel must use --av-surface-sunken so child .pending-card ' +
      '(--av-surface-card) elevates visibly in light + dark modes. ' +
      'Got: ' + rule,
    );
    assert.ok(
      !/background:\s*var\(--av-surface-card\b/.test(rule),
      '.pending-panel must NOT use --av-surface-card (would equal the card ' +
      'background in light mode → invisible cards). Got: ' + rule,
    );
  });

  it('.pending-card uses --av-surface-card (canonical content card surface)', () => {
    const rule = _pendingRule('.pending-card');
    assert.ok(
      rule.includes('--av-surface-card'),
      '.pending-card must use --av-surface-card so it lifts off the ' +
      '--av-surface-sunken parent in both themes. Got: ' + rule,
    );
  });

  it('.pending-card border uses --av-border-default (delineation in light mode)', () => {
    // --av-border-subtle is rgba(15,23,42,0.06) in light — too faint to
    // delineate cards. Default (0.12) is the readable choice.
    const rule = _pendingRule('.pending-card');
    assert.ok(
      rule.includes('--av-border-default'),
      '.pending-card border must use --av-border-default for visible card ' +
      'delineation in light mode. Got: ' + rule,
    );
  });

  it('.pending-card__btn--drop uses transparent background + secondary text', () => {
    // Avoids same-surface-as-card invisibility. Border carries the
    // outline; hover lifts to --av-surface-sunken.
    const rule = _pendingRule('.pending-card__btn--drop');
    assert.ok(
      /background:\s*transparent/.test(rule),
      '.pending-card__btn--drop must use background:transparent (parent ' +
      'card is already --av-surface-card; same-surface fill is invisible). ' +
      'Got: ' + rule,
    );
    assert.ok(
      rule.includes('--av-text-secondary'),
      '.pending-card__btn--drop must use --av-text-secondary for readable ' +
      'label in both themes. Got: ' + rule,
    );
  });
});


describe('Sprint 10.4.1-hotfix — needs-review canonical .vocab-card adoption', () => {
  // Bug 2 regression pin. Module formerly shipped bespoke .nr-card*
  // primitives that diverged visually from my-vocab's needs_review
  // rows. Now reuses .vocab-card / .source-badge / .vocab-action
  // declared in my-vocabulary.css. The needs-review.css bespoke
  // .nr-card* rules are deleted; .needs-review-intro + .nr-toast stay
  // (banner + toast unique to this surface).

  const __dirname2 = dirname(fileURLToPath(import.meta.url));
  const NR_CSS = readFileSync(
    join(__dirname2, '..', 'css', 'needs-review.css'), 'utf8'
  );
  const NR_JS = readFileSync(
    join(__dirname2, '..', 'js', 'vocab-modules', 'needs-review.js'), 'utf8'
  );

  it('needs-review.css declares zero .nr-card* card primitive rules', () => {
    // .nr-toast and .needs-review-intro stay — only the .nr-card family
    // is gone. Match `.nr-card` as a class selector start (immediate
    // followup must be `{`, ` `, `,`, `:`, or `__`, not `.nr-toast` etc).
    assert.ok(
      !/\.nr-card\b/.test(NR_CSS),
      'needs-review.css must NOT redeclare .nr-card* primitives — the ' +
      'module reuses .vocab-card from my-vocabulary.css. Stale rules ' +
      'would re-introduce visual drift.',
    );
  });

  it('needs-review.js emits canonical .vocab-card + .vocab-action classes', () => {
    assert.ok(NR_JS.includes('class="vocab-card"'),
      'needs-review card must use the canonical .vocab-card primitive.');
    assert.ok(NR_JS.includes('class="source-badge badge-needs_review"'),
      'needs-review card must use the canonical .source-badge.badge-needs_review pill.');
    assert.ok(NR_JS.includes('class="vocab-action vocab-action--fixed"'),
      'mark-fixed button must use .vocab-action--fixed (green family).');
    assert.ok(NR_JS.includes('class="vocab-action vocab-action--skip"'),
      'dismiss button must use .vocab-action--skip (red family).');
  });

  it('needs-review.js drops the bespoke .nr-card__* classes', () => {
    assert.ok(
      !/\bnr-card__/.test(NR_JS),
      'needs-review.js must not emit any bespoke .nr-card__* class — ' +
      'all card sub-elements move to the canonical .vocab-card family.',
    );
  });
});


// ── Helpers ──────────────────────────────────────────────────────────

function _extractFunctionBody(declarationPrefix) {
  // Find the function body by matching the first { after the
  // declaration and walking braces. Works for `async function foo`
  // and `function foo`.
  const start = MODULE_SRC.indexOf(declarationPrefix);
  if (start === -1) throw new Error(`Not found: ${declarationPrefix}`);
  let depth = 0;
  let inFn = false;
  for (let i = start; i < MODULE_SRC.length; i++) {
    const c = MODULE_SRC[i];
    if (c === '{') { depth++; inFn = true; }
    else if (c === '}') {
      depth--;
      if (inFn && depth === 0) return MODULE_SRC.slice(start, i + 1);
    }
  }
  throw new Error(`No closing brace for ${declarationPrefix}`);
}
