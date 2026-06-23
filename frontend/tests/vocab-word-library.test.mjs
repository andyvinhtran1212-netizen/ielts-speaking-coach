/**
 * VE4 — word-library tab (Probe-A). Pure render tests + static wiring sentinels.
 * Zero-dep node:test (no jsdom).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderCard, renderGrid } from '../js/vocab-modules/word-library.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');


// ── pure render ───────────────────────────────────────────────────────

const WORD = {
  slug: 'cutting-edge', category: 'technology', headword: 'Cutting-edge',
  level: 'B2', part_of_speech: 'adjective', pronunciation: '/ˈkʌt.ɪŋ.edʒ/',
  gloss_vi: 'Tiên tiến nhất, hiện đại nhất',
};

describe('renderCard', () => {
  test('renders headword/POS/IPA/gloss/level + links to vocab-article with cat&slug', () => {
    const h = renderCard(WORD);
    assert.match(h, /Cutting-edge/);
    assert.match(h, /adjective/);
    assert.match(h, /ˈkʌt\.ɪŋ\.edʒ/);
    assert.match(h, /Tiên tiến nhất/);
    assert.match(h, /B2/);
    assert.match(h, /href="\/pages\/vocab-article\.html\?cat=technology&slug=cutting-edge"/);
    assert.match(h, /class="vc-play"[^>]*data-hw="Cutting-edge"/);
  });

  test('escapes + tolerates missing optional fields (no crash, no undefined)', () => {
    const h = renderCard({ slug: 's', category: 'c', headword: 'A & B', pronunciation: '', gloss_vi: '', level: '', part_of_speech: '' });
    assert.match(h, /A &amp; B/);
    assert.doesNotMatch(h, /undefined/);
  });
});

describe('renderGrid', () => {
  test('one section per non-empty category; empty → placeholder', () => {
    const html = renderGrid([
      { slug: 'technology', title: 'Technology', articles: [WORD] },
      { slug: 'health', title: 'Health', articles: [] },     // empty → skipped
    ]);
    assert.match(html, /vc-cat-title[^>]*>.*Technology/);
    assert.doesNotMatch(html, /Health/);
    assert.match(html, /Cutting-edge/);
    assert.match(renderGrid([]), /vc-empty/);
  });
});


// ── static wiring sentinels ───────────────────────────────────────────

describe('word-library.js wiring', () => {
  const MOD = front('js', 'vocab-modules', 'word-library.js');

  test('data via window.api.get — NO raw fetch (grep-gate)', () => {
    assert.match(MOD, /window\.api\.get\(\s*['"]\/api\/vocabulary\/categories['"]/);
    assert.doesNotMatch(MOD, /\bfetch\s*\(/);
  });
  test('exports mount + uses speechSynthesis (no bucket / no /tts)', () => {
    assert.match(MOD, /export async function mount\(/);
    assert.match(MOD, /speechSynthesis/);
    assert.doesNotMatch(MOD, /\/tts\b/);
  });
});

describe('vocab-landing + vocabulary.html wiring', () => {
  const LANDING = front('js', 'vocab-landing.js');
  const PAGE = front('pages', 'vocabulary.html');

  test('TAB_LOADERS + VALID_TABS include word-library', () => {
    assert.match(LANDING, /'word-library':\s*\(\)\s*=>\s*import\('\/js\/vocab-modules\/word-library\.js'\)/);
    assert.match(LANDING, /VALID_TABS[\s\S]*'word-library'/);
  });
  test('page has the mode-card + panel + mount target', () => {
    assert.match(PAGE, /class="mode-card"\s+data-mode="word-library"/);
    assert.match(PAGE, /data-panel="word-library"/);
    assert.match(PAGE, /id="mount-word-library"/);
  });
});
