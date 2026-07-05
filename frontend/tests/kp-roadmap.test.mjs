import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

const ROADMAP_HTML = readFileSync(path.join(REPO_ROOT, 'frontend/pages/grammar-roadmap.html'), 'utf8');
const KP_JS = readFileSync(path.join(REPO_ROOT, 'frontend/js/kp-roadmap.js'), 'utf8');

describe('personal KP roadmap wiring', () => {
  test('page loads kp-roadmap.js', () => {
    assert.match(ROADMAP_HTML, /kp-roadmap\.js/);
  });

  test('no-slug branch calls the personal roadmap, slug branch keeps per-article', () => {
    assert.match(ROADMAP_HTML, /kpRoadmap\.loadPersonalRoadmap\(\)/);
    assert.match(ROADMAP_HTML, /grammarWiki\.loadGrammarRoadmap\(\)/);
    // The branch is keyed on the slug query param.
    assert.match(ROADMAP_HTML, /getResultParam|get\('slug'\)|hasSlug/);
  });

  test('kp-roadmap fetches the authed personal endpoint', () => {
    assert.match(KP_JS, /window\.api\.get\('\/api\/me\/roadmap'\)/);
  });

  test('article links use clean /grammar/{category}/{slug} routes', () => {
    assert.match(KP_JS, /'\/grammar\/'/);
    assert.doesNotMatch(KP_JS, /grammar\.html\?/);
  });

  test('handles both personal and static (empty) modes', () => {
    assert.match(KP_JS, /mode === 'personal'/);
    assert.match(KP_JS, /renderEmpty/);
  });

  test('API/schema failures render an error state, not the empty CTA', () => {
    assert.match(KP_JS, /function renderError/);
    // the catch (and the unexpected-shape branch) route to renderError
    assert.match(KP_JS, /catch \(err\) \{\s*(?:\/\/[^\n]*\n\s*)*renderError\(\)/);
  });
});

describe('design-token compliance (no hardcoded colours)', () => {
  test('status colours come from --av-* tokens, not raw hex/rgb', () => {
    // Strip token definitions/comments; the rendered markup must not hardcode colours.
    const body = KP_JS.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, 'no hex colours in rendered markup');
    assert.doesNotMatch(body, /rgba?\(/, 'no raw rgb() colours in rendered markup');
    assert.match(body, /var\(--av-error\)/);
    assert.match(body, /var\(--av-warning\)/);
    assert.match(body, /var\(--av-surface-card\)/);
  });

  test('untrusted node text is HTML-escaped', () => {
    assert.match(KP_JS, /WC\.escapeHtml/);
    assert.match(KP_JS, /esc\(n\.title/);
  });
});
