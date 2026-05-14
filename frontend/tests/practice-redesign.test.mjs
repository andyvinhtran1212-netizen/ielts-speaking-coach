/**
 * frontend/tests/practice-redesign.test.mjs — Sprint 6.5.
 *
 * Run with: node --test frontend/tests/practice-redesign.test.mjs
 *
 * Pins the Sprint 6.5 redesign of /pages/practice.html. The page is a
 * 12-state recording machine wired to MediaRecorder + the PracticeApp
 * global, so the redesign was scoped:
 *   • fonts swapped: Manrope+Fraunces → Plus Jakarta Sans + JetBrains Mono
 *   • Aver Design System foundation linked (tokens.css + components.css)
 *   • inline <style> + ~70 inline rgba/hex declarations swept to
 *     /css/practice.css using --av-* tokens (semantic role mapping per
 *     UNIFIED_DESIGN_BRIEF.md § 11)
 *   • header inline-styled back link → .practice-back-link with Lucide
 *   • test-mode banner, AI fallback warning, mode-choice cards,
 *     primary action buttons (record / stop / submit / re-record /
 *     volume-2 / play / file-down / arrow-right) → Lucide icons
 *   • full light + dark theme support FROM DAY 1 (no force-dark, no
 *     DEBT entry — the Sprint 6.4.1/6.4.2 lesson applied up front)
 *
 * What this test guards: the redesign decisions above and the JS
 * coupling that mustn't break (every #state-* container, every #rec-*
 * sub-state, every PracticeApp.* onclick handler, the canvas IDs the
 * waveform recorder draws into).
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


let html;
let css;

before(() => {
  html = readFileSync(
    path.join(__dirname, '..', 'pages', 'practice.html'),
    'utf8',
  );
  css = readFileSync(
    path.join(__dirname, '..', 'css', 'practice.css'),
    'utf8',
  );
});


// ── Foundation links ───────────────────────────────────────────────


describe('practice.html / foundation links', () => {
  test('links Aver tokens.css before components.css before practice.css', () => {
    const tokensIdx = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    const practiceIdx = html.indexOf('css/practice.css');
    assert.ok(tokensIdx > -1, 'tokens.css must be linked');
    assert.ok(componentsIdx > -1, 'components.css must be linked');
    assert.ok(practiceIdx > -1, 'practice.css must be linked');
    assert.ok(
      tokensIdx < componentsIdx && componentsIdx < practiceIdx,
      'load order must be tokens → components → practice so the cascade resolves correctly',
    );
  });

  test('imports Plus Jakarta Sans + JetBrains Mono', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
  });

  test('does NOT import Manrope, Fraunces, or Inter', () => {
    assert.ok(!/family=Manrope/.test(html), 'Manrope was Sprint 6.2 — removed in 6.5 redesign');
    assert.ok(!/family=Fraunces/.test(html), 'Fraunces was Sprint 6.2 — removed in 6.5 redesign');
    assert.ok(!/family=Inter[:&]/.test(html), 'Inter must not return on the redesigned page');
  });

  test('Tailwind config fontFamily.sans is Plus Jakarta Sans', () => {
    assert.match(html, /fontFamily\s*:\s*\{[\s\S]*?sans:\s*\[\s*'Plus Jakarta Sans'/);
  });
});


// ── Theme support (Sprint 6.5: full light + dark from day 1) ───────


describe('practice.html / theme support', () => {
  test('anti-flash IIFE reads localStorage av-theme + system preference', () => {
    const iifeIdx = html.search(/localStorage\.getItem\(['"]av-theme['"]\)/);
    const firstLinkIdx = html.search(/<link\s+rel="stylesheet"/);
    assert.ok(iifeIdx > -1, "IIFE must read localStorage 'av-theme'");
    assert.ok(firstLinkIdx > -1, 'page must link at least one stylesheet');
    assert.ok(
      iifeIdx < firstLinkIdx,
      'theme bootstrap IIFE must run BEFORE any stylesheet to prevent flash',
    );
    assert.match(
      html,
      /prefers-color-scheme:\s*dark/,
      'IIFE must fall back to system preference when no stored theme',
    );
  });

  test('IIFE does NOT hardcode data-theme="dark" (no force-dark, no DEBT)', () => {
    // Sprint 6.5 applies the Sprint 6.4.1/6.4.2 lesson — no force-dark
    // shortcut. Both themes ship from day 1.
    const forceDark = /setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]dark['"]\s*\)/.test(html);
    assert.ok(
      !forceDark,
      "force-dark setAttribute call must NOT exist — practice.html supports both themes from Sprint 6.5",
    );
  });

  test('Sprint 7.13 — chrome migrated to <aver-chrome active="speaking">', () => {
    assert.match(html, /<aver-chrome\s+active="speaking"\s*>/);
    assert.match(
      html,
      /<script\s+type="module"\s+src="\/js\/components\/aver-chrome\.js">\s*<\/script>/,
    );
  });

  test('Sprint 7.13 — inline chrome markup + bindToggleButton import retired', () => {
    assert.equal(/class="av-theme-toggle"/.test(html), false);
    assert.equal(
      /import\s*\{\s*bindToggleButton\s*\}\s*from\s*['"][^'"]*theme-toggle\.js['"]/.test(html),
      false,
    );
  });
});


// ── JS-coupled selectors (the practice.js state machine) ──────────


describe('practice.html / state container IDs', () => {
  test('all 12 state container IDs preserved', () => {
    // practice.js drives the .state.active toggle on each of these. A
    // rename on any one breaks the state machine.
    const states = [
      'state-loading',
      'state-error',
      'state-mode-choice',
      'state-prep',
      'state-p2a',
      'state-p2b',
      'state-p2c',
      'state-processing',
      'state-feedback',
      'state-completion',
      'state-break',
      'state-test-results',
    ];
    for (const id of states) {
      assert.match(
        html,
        new RegExp(`id="${id}"`),
        `#${id} state container must remain — practice.js toggles .state.active on it`,
      );
    }
  });

  test('test-mode banner + progress bar IDs preserved', () => {
    for (const id of [
      'test-mode-banner',
      'progress-bar-wrap',
      'progress-bar-label',
      'progress-bar-fill',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
  });

  test('header info IDs preserved (hdr-info, hdr-progress)', () => {
    assert.match(html, /id="hdr-info"/);
    assert.match(html, /id="hdr-progress"/);
  });
});


describe('practice.html / recording sub-state IDs', () => {
  test('inline-rec-section + 3 rec sub-state IDs preserved', () => {
    for (const id of [
      'inline-rec-section',
      'rec-error',
      'rec-idle',
      'rec-recording',
      'rec-recorded',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
  });

  test('recording timer + canvas + duration IDs preserved', () => {
    for (const id of [
      'rec-timer',
      'rec-canvas',
      'rec-duration-display',
      'p2c-timer',
      'p2c-canvas',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
  });

  test('canvas elements are still <canvas> (the waveform draw target)', () => {
    // A future refactor that replaces <canvas> with <div> would silently
    // break the waveform visualization. Pin the tag.
    assert.match(html, /<canvas[^>]+id="rec-canvas"/);
    assert.match(html, /<canvas[^>]+id="p2c-canvas"/);
  });
});


describe('practice.html / prep state IDs', () => {
  test('all prep-* IDs preserved', () => {
    for (const id of [
      'prep-fallback-warning',
      'prep-part-badge',
      'prep-topic',
      'prep-q-counter',
      'prep-mode-toggle',
      'prep-mode-visual',
      'prep-mode-listening',
      'prep-listen-bar',
      'prep-play-btn',
      'prep-q-card',
      'prep-text-reveal',
      'prep-q-text',
      'prep-reveal-btn',
      'prep-cue',
      'prep-cue-bullets',
      'prep-cue-reflection',
      'prep-instruction',
      'prep-start-btn',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain (referenced by PracticeApp)`);
    }
  });

  test('all p2a-* IDs preserved', () => {
    for (const id of ['p2a-topic', 'p2a-question', 'p2a-bullets', 'p2a-reflection']) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
  });

  test('p2b-notes textarea + p2b-question/timer preserved', () => {
    for (const id of ['p2b-notes', 'p2b-question', 'p2b-timer']) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
  });
});


describe('practice.html / feedback state IDs', () => {
  test('all feedback-* IDs preserved', () => {
    for (const id of [
      'feedback-band-wrapper',
      'feedback-band',
      'feedback-bands-row',
      'feedback-comments',
      'feedback-transcript',
      'feedback-transcript-text',
      'feedback-audio-section',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
  });

  test('grammar + pronunciation block IDs preserved', () => {
    for (const id of [
      'grammar-resources',
      'grammar-resources-cards',
      'pronunciation-section',
      'pron-loading-block',
      'pron-result-block',
      'full-pron-section',
      'full-pron-block',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
  });

  test('navigation button IDs preserved', () => {
    for (const id of ['btn-next-q', 'btn-finish', 'btn-export-pdf']) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
  });

  test('break + test-results IDs preserved', () => {
    for (const id of [
      'break-part-label',
      'break-timer',
      'test-overall-wrap',
      'test-overall-band',
      'test-results-list',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
  });
});


describe('practice.html / PracticeApp onclick contract', () => {
  test('PracticeApp.chooseModeAndStart for both modes', () => {
    assert.match(html, /onclick="PracticeApp\.chooseModeAndStart\('visual'\)"/);
    assert.match(html, /onclick="PracticeApp\.chooseModeAndStart\('listening'\)"/);
  });

  test('PracticeApp recording handlers bound', () => {
    for (const fn of [
      'startRecording',
      'stopRecording',
      'resetRecording',
      'submitRecording',
      'goToRecording',
      'setQMode',
      'playQuestion',
      'revealQuestionText',
      'startP2Prep',
      'startP2SpeakingEarly',
      'stopP2SpeakingEarly',
      'replayAudio',
      'downloadAudio',
      'nextQuestion',
      'finishSession',
      'downloadPDFs',
    ]) {
      assert.match(
        html,
        new RegExp(`PracticeApp\\.${fn}\\(`),
        `PracticeApp.${fn}() onclick handler must remain`,
      );
    }
  });

  test('PracticeApp.init() bootstrap call preserved', () => {
    assert.match(html, /PracticeApp\.init\(\s*\)/);
  });
});


// ── Lucide icon swap ──────────────────────────────────────────────


describe('practice.html / Lucide icon swap', () => {
  test('Lucide CDN + hydration script present', () => {
    assert.match(html, /unpkg\.com\/lucide@latest/);
    assert.match(html, /lucide\.createIcons/);
  });

  test('header back link uses Lucide chevron-left (not arrow emoji)', () => {
    const header = html.match(/<header[^>]*practice-header[\s\S]*?<\/header>/);
    assert.ok(header, 'practice-header block must exist');
    assert.match(
      header[0],
      /data-lucide="chevron-left"/,
      'back link must use Lucide chevron-left',
    );
    // Original emoji ← should be gone.
    assert.ok(
      !header[0].includes('← Dashboard'),
      'header must not ship the legacy ← arrow before "Dashboard"',
    );
  });

  test('mode-choice cards use Lucide eye + volume-2 (no emoji 👁 / 🔊)', () => {
    const block = html.match(/id="state-mode-choice"[\s\S]*?<\/div>\s*<\/div>/);
    assert.ok(block, 'mode-choice state must exist');
    assert.match(block[0], /data-lucide="eye"/);
    assert.match(block[0], /data-lucide="volume-2"/);
    // The emoji versions should be gone from the mode-choice block.
    assert.ok(!block[0].includes('👁'), 'mode-choice must not ship 👁 emoji');
    assert.ok(!block[0].includes('🔊'), 'mode-choice must not ship 🔊 emoji');
  });

  test('primary recording action buttons use Lucide icons', () => {
    // Stop button: square icon
    assert.match(html, /<i\s+data-lucide="square"/);
    // Mic button (start recording / inline rec-idle)
    assert.match(html, /<i\s+data-lucide="mic"/);
    // Re-record (rotate-ccw)
    assert.match(html, /<i\s+data-lucide="rotate-ccw"/);
    // Submit (upload)
    assert.match(html, /<i\s+data-lucide="upload"/);
    // Test mode banner
    assert.match(html, /<i\s+data-lucide="alert-triangle"/);
    // PDF export
    assert.match(html, /<i\s+data-lucide="file-down"/);
  });
});


// ── Theme + body class ────────────────────────────────────────────


describe('practice.html / body class', () => {
  test('body opts into .av-page (Aver page surface)', () => {
    assert.match(html, /<body[^>]*class="[^"]*\bav-page\b[^"]*"/);
  });

  test('body does NOT carry the legacy ds-canvas class', () => {
    assert.ok(
      !/<body[^>]*class="[^"]*\bds-canvas\b[^"]*"/.test(html),
      'practice.html should drop ds-canvas — av-page + [data-theme] handle theming',
    );
  });

  test('body does NOT hardcode text-white (Sprint 6.4.2 lesson)', () => {
    const m = html.match(/<body[^>]*class="([^"]+)"/);
    assert.ok(m, '<body> must have a class attribute');
    assert.ok(
      !/\btext-white\b/.test(m[1]),
      `<body> must not include Tailwind's text-white — light theme would render the page invisibly`,
    );
  });
});


// ── Color migration / token discipline ───────────────────────────


describe('practice.html / color migration', () => {
  test('zero live inline rgba(255,255,255,X) declarations remain', () => {
    // Strip HTML comments first — the explanatory comment may mention
    // the literal pattern.
    const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
    const matches = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/gi) || [];
    assert.equal(
      matches.length,
      0,
      `expected 0 inline rgba(255,255,255,X) values in HTML, found ${matches.length}. ` +
      `Sprint 6.5 swept these to --av-* tokens.`,
    );
  });

  test('Vietnamese microcopy lifted from existing page (no drift)', () => {
    // Spot-check that the redesign preserved the canonical strings —
    // a reword would ship different wording to the user, so flag it.
    for (const phrase of [
      'Đang tải',
      'Đã xảy ra lỗi',
      'Chọn chế độ câu hỏi',
      'Câu hỏi sẽ được trình bày như thế nào?',
      'Listening',
      'Visual',
      'Bắt đầu ghi âm',
      'Dừng ghi âm',
      'Nộp để chấm điểm',
      'Tải xuống báo cáo PDF',
      'Bạn đã hoàn thành Full Test',
    ]) {
      assert.ok(
        html.includes(phrase),
        `microcopy "${phrase}" must be preserved verbatim`,
      );
    }
  });
});


describe('practice.css / token discipline (Sprint 6.5)', () => {
  test('references --av-* tokens heavily', () => {
    const avRefs = (css.match(/var\(--av-/g) || []).length;
    assert.ok(
      avRefs > 80,
      `practice.css must reference --av-* tokens throughout (found ${avRefs}); ` +
      `if this drops, components are likely hardcoding colors again`,
    );
  });

  test('does NOT reference legacy --ds-* tokens', () => {
    assert.ok(
      !/var\(--ds-/.test(css),
      'practice.css should be on --av-* (Sprint 6.5); --ds-* references would be drift',
    );
  });

  test('does NOT use the non-existent --av-space-5 / -7 / -9 / -10 / -11 / -13 / -14 / -15 tokens', () => {
    // Same Sprint 6.4.1 trap: the 4px scale skips these steps to enforce
    // discipline. A reference resolves to an invalid declaration which
    // CSS silently drops — visual regressions ensue.
    assert.ok(
      !/var\(--av-space-(5|7|9|10|11|13|14|15)\)/.test(css),
      'practice.css uses a skipped step in the 4px scale. ' +
      'Allowed steps: 0,1,2,3,4,6,8,12,16,20,24.',
    );
  });

  test('avoids bare hardcoded teal hex in component declarations', () => {
    const lines = css.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\/\*|^\s*\*/.test(line)) continue;
      if (/#0[Ff]766[Ee]|#14[Bb]8[Aa]6/.test(line)) {
        assert.fail(
          `practice.css line ${i + 1} hardcodes a teal hex value — use var(--av-primary). ` +
          `Line: ${line.trim()}`,
        );
      }
    }
  });

  test('declares all the legacy classes that the page still uses', () => {
    const requiredClasses = [
      '.state',
      '.card',
      '.cue-card',
      '.btn-primary',
      '.btn-danger',
      '.btn-ghost',
      '.spinner',
      '.band-circle',
    ];
    for (const cls of requiredClasses) {
      const re = new RegExp(`(^|[\\s,])${cls.replace('.', '\\.')}(\\s|[,{:])`, 'm');
      assert.match(
        css,
        re,
        `practice.css must declare ${cls} (the page still uses it; dropping leaves it unstyled)`,
      );
    }
  });
});


// ── Sprint 6.4.2 contrast lesson applied ─────────────────────────


describe('practice.css / contrast discipline (Sprint 6.4.2 lesson)', () => {
  test('--av-text-faint usage is capped (auxiliary contexts only)', () => {
    // Cap per UNIFIED_DESIGN_BRIEF.md § 11.5 — anything more than 10
    // means the redesign is over-mapping into the failing-AA tier.
    const matches = css.match(/var\(--av-text-faint\)/g) || [];
    assert.ok(
      matches.length <= 10,
      `practice.css references --av-text-faint ${matches.length} times; ` +
      `expected ≤ 10 (placeholders + duration meta + transcript eyebrow only). ` +
      `Re-review semantic mapping per Sprint 6.4.2 lesson.`,
    );
  });

  test('text-secondary usage exceeds text-faint (semantic discipline)', () => {
    const secondaryCount = (css.match(/var\(--av-text-secondary\)/g) || []).length;
    const faintCount = (css.match(/var\(--av-text-faint\)/g) || []).length;
    assert.ok(
      secondaryCount > faintCount,
      `--av-text-secondary count (${secondaryCount}) must exceed --av-text-faint (${faintCount}) — ` +
      `helper text and content sub-labels should land on secondary, not faint.`,
    );
  });
});


// ── Sprint 6.5.1 — question card contrast hotfix ───────────────────


describe('practice.css / Sprint 6.5.1 contrast fix', () => {
  test('practice.css has zero hardcoded white text values', () => {
    // The question card bug came from `color: #fff` in ds.css. This pin
    // catches a regression where someone re-introduces the same pattern
    // inside practice.css.
    const lines = css.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\/\*|^\s*\*/.test(line)) continue;
      assert.ok(
        !/color\s*:\s*#fff\b/i.test(line),
        `practice.css line ${i + 1} hardcodes color:#fff — use var(--av-text-primary). ` +
        `Line: ${line.trim()}`,
      );
      assert.ok(
        !/color\s*:\s*white\b/i.test(line),
        `practice.css line ${i + 1} hardcodes color:white — use var(--av-text-primary). ` +
        `Line: ${line.trim()}`,
      );
      assert.ok(
        !/color\s*:\s*rgba\(255\s*,\s*255\s*,\s*255/i.test(line),
        `practice.css line ${i + 1} hardcodes color:rgba(255,255,255,X) — use a token. ` +
        `Line: ${line.trim()}`,
      );
    }
  });

  test('overrides .ds-question-card .ds-q-text on .av-page (light theme readable)', () => {
    // ds.css line 133 sets `color: #fff` on the question text. On the
    // cream light surface that's white-on-cream = invisible. The override
    // must lift question text to --av-text-primary so the user can read
    // the IELTS question while answering.
    const re = /body\.av-page\s+\.ds-question-card\s+\.ds-q-text\s*\{[^}]*color\s*:\s*var\(--av-text-primary\)/;
    assert.match(
      css,
      re,
      'practice.css must override .ds-question-card .ds-q-text → --av-text-primary on .av-page',
    );
  });

  test('overrides .ds-question-card chrome (background + border) for light theme', () => {
    // The card surface + 4px left accent must also flip to tokens or
    // they stay washed white-on-white in light theme.
    const re = /body\.av-page\s+\.ds-question-card\s*\{[\s\S]*?(background[\s\S]*?var\(--av-surface[\s\S]*?border[\s\S]*?var\(--av-border|border[\s\S]*?var\(--av-border[\s\S]*?background[\s\S]*?var\(--av-surface)/;
    assert.match(
      css,
      re,
      '.ds-question-card must use --av-surface-* + --av-border-* tokens (override of ds.css hardcoded rgba whites)',
    );
    // Plus the question label color should track the brand teal token,
    // not the legacy --ds-teal-lt that resolves to a dark-only value.
    assert.match(
      css,
      /body\.av-page\s+\.ds-question-card\s+\.ds-q-label\s*\{[^}]*color\s*:\s*var\(--av-primary\)/,
      '.ds-q-label must use var(--av-primary) so the eyebrow flips with theme',
    );
  });

  test('overrides .ds-cue-bullet, .ds-strength-item, .ds-improve-item to readable tokens', () => {
    // All three are JS-rendered list-item rows that ds.css paints with
    // rgba(255,255,255,0.8) — invisible on light. They render the
    // user-facing content (cue points, strengths, things to improve),
    // so they belong in --av-text-secondary.
    for (const sel of ['.ds-cue-bullet', '.ds-strength-item', '.ds-improve-item']) {
      const re = new RegExp(
        `body\\.av-page\\s+(\\.[\\w-]+\\s*,\\s*body\\.av-page\\s+)*${sel.replace('.', '\\.')}` +
        `[^{]*\\{[^}]*color\\s*:\\s*var\\(--av-text-secondary\\)`,
      );
      assert.match(
        css,
        re,
        `${sel} must be overridden to --av-text-secondary on .av-page`,
      );
    }
  });

  test('rec-hint (recording guidance copy) uses --av-text-secondary', () => {
    // "Đang ghi âm — nói rõ ràng vào microphone" is primary recording
    // guidance; it must read clearly. Sprint 6.5 originally used
    // --av-text-muted; 6.5.1 lifts to --av-text-secondary per § 11.1.
    const m = css.match(/\.practice-rec-hint\s*\{([^}]+)\}/);
    assert.ok(m, '.practice-rec-hint rule must exist');
    assert.match(
      m[1],
      /color\s*:\s*var\(--av-text-secondary\)/,
      '.practice-rec-hint must use --av-text-secondary so the recording instruction reads on cream',
    );
  });
});
