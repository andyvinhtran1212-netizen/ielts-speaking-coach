/**
 * VE4 — word-library tab (Probe-A). Pure render tests + static wiring sentinels.
 * Zero-dep node:test (no jsdom).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderCard, renderGrid, flattenWords, filterWords, renderChips, renderEmpty,
} from '../js/vocab-modules/word-library.js';

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

  test('Slice-2: carries data-audio when a pregenerated audio_headword exists', () => {
    const h = renderCard({ ...WORD, audio_headword: 'https://cdn/x.mp3' });
    assert.match(h, /data-audio="https:\/\/cdn\/x\.mp3"/);
    // no audio → empty data-audio (▶ falls back to speechSynthesis)
    assert.match(renderCard(WORD), /data-audio=""/);
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


// ── Slice-B: client-side filter + search (pure fns) ───────────────────

const WORDS = [
  WORD,
  { slug: 'holistic', category: 'health', headword: 'Holistic', gloss_vi: 'Toàn diện' },
  { slug: 'equity', category: 'business-finance', headword: 'Equity', gloss_vi: 'Vốn chủ sở hữu' },
];

describe('flattenWords', () => {
  test('flattens category sections into one word list', () => {
    const flat = flattenWords([
      { slug: 'health', articles: [WORDS[1]] },
      { slug: 'business-finance', articles: [WORDS[2]] },
    ]);
    assert.equal(flat.length, 2);
    assert.deepEqual(flat.map((w) => w.slug), ['holistic', 'equity']);
  });
});

describe('filterWords', () => {
  test('no query + no category → all words (identity)', () => {
    assert.equal(filterWords(WORDS, '', '').length, 3);
  });
  test('category scopes the list', () => {
    const out = filterWords(WORDS, '', 'health');
    assert.deepEqual(out.map((w) => w.slug), ['holistic']);
  });
  test('query matches headword OR gloss (case-insensitive)', () => {
    assert.deepEqual(filterWords(WORDS, 'equ', '').map((w) => w.slug), ['equity']);   // headword
    assert.deepEqual(filterWords(WORDS, 'toàn diện', '').map((w) => w.slug), ['holistic']); // gloss
  });
  test('query + category compose (search within scope)', () => {
    assert.equal(filterWords(WORDS, 'equity', 'health').length, 0);  // equity not in health
    assert.equal(filterWords(WORDS, 'holistic', 'health').length, 1);
  });
  test('no match → empty array', () => {
    assert.equal(filterWords(WORDS, 'zzzzz', '').length, 0);
  });
});

describe('renderChips', () => {
  test('"Tất cả" first with total count, one chip per non-empty category, active flagged', () => {
    const html = renderChips([
      { slug: 'health', title: 'Health', article_count: 2, articles: [WORDS[1]] },
      { slug: 'business-finance', title: 'Business Finance', article_count: 5, articles: [WORDS[2]] },
    ], 'health');
    assert.match(html, /Tất cả/);
    assert.match(html, /vc-chip is-active"[^>]*data-cat="health"/);   // selected chip jade-filled
    assert.match(html, /Business Finance/);
    assert.match(html, /vc-chip-n">7</);   // "Tất cả" total = 2 + 5
  });
});

describe('renderEmpty', () => {
  test('invites another action (not a blank void) + escapes the query', () => {
    const h = renderEmpty('a & b');
    assert.match(h, /Không tìm thấy/);
    assert.match(h, /a &amp; b/);
    assert.match(h, /bỏ lọc chủ đề|từ khóa khác/);
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
  test('Slice-B: search input + chip row + debounce + empty-state branch wired', () => {
    assert.match(MOD, /class="vc-search"/);            // search box rendered
    assert.match(MOD, /class="vc-search-clear"/);      // clear (x) button
    assert.match(MOD, /renderChips\(/);                // chip row
    assert.match(MOD, /function debounce\(/);          // debounced input
    assert.match(MOD, /addEventListener\('input'/);    // search listens on input
    assert.match(MOD, /renderEmpty\(/);                // empty-state branch
    assert.match(MOD, /cancelSpeech\(\)/);             // utterance cancelled on scope change
  });
  test('Slice-2: ▶ prefers pregenerated audio (new Audio) then falls back to speechSynthesis', () => {
    assert.match(MOD, /function playWord\(/);          // prefer-audio entry point
    assert.match(MOD, /new Audio\(/);                  // plays the mp3 URL
    assert.match(MOD, /\.catch\(\(\) => speak\(/);     // playback error → speechSynthesis fallback
    assert.match(MOD, /playWord\(play\.dataset\.audio/); // wired to the ▶ button
  });
});

describe('vocab-article audio wiring (vocabulary.js — v2 delegated ▶)', () => {
  const VJS = front('js', 'vocabulary.js');

  test('▶ buttons prefer pregenerated audio (data-audio) then speechSynthesis', () => {
    // V-article: per-button onclick + speakExample retired for a single delegated
    // .va-play handler that prefers data-audio (mp3) and falls back to data-say.
    assert.match(VJS, /data-audio="\$\{esc\(audioUrl/);   // playBtn carries the URL
    assert.match(VJS, /new Audio\(/);                       // plays the mp3
    assert.match(VJS, /\.catch\(\(\) => \{[^}]*fallbackSpeak/); // playback error → fallback
    assert.match(VJS, /closest\('\.va-play'\)/);            // delegated handler
  });
  test('headword + example each get a ▶ with its audio URL', () => {
    assert.match(VJS, /playBtn\(a\.audio_headword, a\.headword/);          // headword ▶
    assert.match(VJS, /playBtn\(a\.audio_example, a\.example, 'va-small va-ghost'\)/); // example ▶
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
  test('each category section is a horizontal-scroll row (not a wrapping grid)', () => {
    // Scoped to .vc-cat .vc-grid so the flat search results keep wrapping.
    assert.match(PAGE, /\.vc-cat \.vc-grid\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/);
    assert.match(PAGE, /\.vc-cat \.vc-grid \.vc-card\s*\{[^}]*flex:\s*0 0/);   // fixed-width cards
  });
});
