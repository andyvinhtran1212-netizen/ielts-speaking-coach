// Browser-backed layout contract for the native Listening test player.
//
// Every Part of every fixture is rendered at 360, 390 and 1280 px. The player
// page is `overflow: hidden`, so anything wider than the viewport is silently
// clipped rather than scrollable. The contract therefore measures geometry,
// not only scrollbars:
//   - the document, the shell and the question paper never scroll sideways;
//   - no element inside the paper ends past the paper's right edge unless a
//     horizontally scrollable wrapper (overflow-x: auto/scroll) contains it;
//   - every fixed palette control (Part tabs, Previous/Next/Review/Submit) is
//     fully inside the viewport and is the element hit at its own centre.
//
// Built-in fixtures are synthetic stress shapes. Pass `--fixtures <dir>` to also
// run local student-safe payload JSON files (for example QA exports of real
// papers); those files are never committed.
import { chromium } from 'playwright';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { storageKey } from './supabase-session.mjs';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const FIXTURE_DIR = option('--fixtures');
const SHOT_DIR = option('--screenshots');
const BASE = args.find((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--')) || 'http://localhost:3000';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const PRODUCTION_BACKEND = 'https://ielts-speaking-coach-production.up.railway.app';
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111126';
const FAKE_USER_ID = '00000000-0000-0000-0000-000000000126';
// Student delivery, the admin draft preview (how QA opens unpublished papers)
// and the mock-exam embed each change the shell's rows or the submit row.
const MODES = [
  { name: 'student', query: '' },
  { name: 'admin preview', query: '&admin_preview=1' },
  { name: 'mock embed', query: '&mock_embed=1' },
];
const VIEWPORTS = [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 800 }];
const fakeSession = JSON.stringify({
  access_token: 'listening-overflow-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: FAKE_USER_ID, email: 'listening-overflow@local' },
});

const LONG = 'Representativeness-and-counterbalancing-considerations';
// 72 characters with no line-break opportunity at all (no space, hyphen or
// slash), unlike LONG and the URLs above; only overflow-wrap can break it.
const UNBROKEN = 'BOOKING_REFERENCE_CRB2026_COMMUNITY_HERITAGE_TRUST_VOLUNTEER_DESK_000126';
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
function synthetic(id, title, sections) {
  return {
    id, test_id: id, title, test_type: 'full', programme_id: 'ielts', scoring_policy: 'diagnostic',
    replay_policy: null, themes: {}, audio_url: 'https://audio.fixture/ready.wav', audio_duration_seconds: 120,
    cue_points: [], sections: sections.map((exercises, index) => ({ section_num: index + 1, title: `Part ${index + 1}`, exercises })),
  };
}
const opts = (letters, text) => letters.split('').map((label) => ({ label, text: text(label) }));
const BUILT_IN = [
  // A full 4 × 10 palette: its intrinsic width once pushed the desktop shell
  // past the viewport and clipped the Submit button (#1564).
  synthetic('overflow-palette', 'Overflow fixture: full 40-question palette', [1, 11, 21, 31].map((first) => [{
    id: `q${first}`, exercise_type: 'dictation', payload: {
      template_kind: 'short_answer', instruction: 'Write NO MORE THAN TWO WORDS for each answer.',
      questions: range(first, first + 9).map((q_num) => ({ q_num, prompt: `Question ${q_num} prompt` })),
    },
  }])),
  synthetic('overflow-forms', 'Overflow fixture: wide form, table and notes', [
    [{ id: 'f1', exercise_type: 'dictation', payload: {
      template_kind: 'form_completion', instruction: 'Complete the form. Write ONE WORD AND/OR A NUMBER for each answer.',
      questions: range(1, 3).map((q_num) => ({ q_num, prompt: '' })),
      template: { heading: `ENROLMENT FORM — ${LONG}`, rows: [
        { label: 'Reference', example: 'https://www.example-community-centre.org/volunteers/registration/2026' },
        { label: `Preferred ${LONG}`, q_num: 1, prefix: '£' },
        { label: 'Emergency contact (name, relationship, daytime phone)', q_num: 2, prefix: 'Mrs', suffix: 'from the neighbourhood association' },
        { label: 'Dietary requirements', q_num: 3 },
      ] },
    } }, { id: 't1', exercise_type: 'dictation', payload: {
      template_kind: 'table_completion', instruction: 'Complete the table.',
      questions: range(4, 8).map((q_num) => ({ q_num, prompt: '' })),
      template: { heading: 'Community heritage preservation trust', headers: ['Activity', 'Location', 'Requirements', 'Additional notes for volunteers'], rows: [
        ['Guided-walk-leadership', 'Riverside-conservation-area', { q_num: 4, prefix: 'must have' }, { q_num: 5, prefix: 'contact' }],
        [LONG, { q_num: 6 }, 'First-aid-certificate-required', { q_num: 7, suffix: 'every weekend' }],
        ['Archive-digitisation', 'Main-library-basement', 'none', { q_num: 8, prefix: 'bring your own' }],
      ] },
    } }],
    [{ id: 'n1', exercise_type: 'dictation', payload: {
      template_kind: 'notes_completion', instruction: 'Complete the notes below.',
      questions: range(11, 13).map((q_num) => ({ q_num, prompt: '' })),
      template: { heading: `Notes: ${LONG}`, groups: [{ heading: `Methodology ${LONG}`, items: [
        { text: `Sampling: ${LONG} ${LONG}` },
        { q_num: 11, prefix: 'https://www.example-community-centre-booking-service.org/volunteers', suffix: LONG },
        { q_num: 12, prefix: `Interview schedule ${LONG}` },
        { q_num: 13, prefix: 'Final report due' },
      ] }] },
    } }, { id: 's1', exercise_type: 'dictation', payload: {
      template_kind: 'summary_completion', instruction: 'Complete the summary below.',
      questions: [{ q_num: 14, prompt: '' }, { q_num: 15, prompt: '' }],
      template: { paragraph: `The ${LONG} framework requires {{Q14}} before https://www.example.org/a-very-long-unbroken-reference-path/with-more-segments and {{Q15}}.` },
    } }],
  ]),
  synthetic('overflow-choices', 'Overflow fixture: long choices, matching and plan', [
    [{ id: 'c1', exercise_type: 'mcq', payload: {
      template_kind: 'mcq_3option', instruction: 'Choose the correct letter, A, B or C.',
      questions: [21, 22].map((q_num) => ({ q_num, prompt: `Why did the researchers reject the ${LONG} model?`,
        options: opts('ABC', (label) => (label === 'B' ? 'https://www.example.org/a-very-long-unbroken-reference-path/with-more-segments' : `because ${LONG}`)) })),
    } }, { id: 'c2', exercise_type: 'mcq', payload: {
      template_kind: 'mcq_multi', instruction: 'Choose TWO letters, A–E.',
      metadata: { match_options: opts('ABCDE', () => `the ${LONG} survey`) },
      questions: [23, 24].map((q_num) => ({ q_num, prompt: `Which TWO ${LONG} features?` })),
    } }],
    [{ id: 'm1', exercise_type: 'mcq', payload: {
      template_kind: 'matching', instruction: 'Write the correct letter, A–H, next to Questions 31–34.',
      metadata: { match_options: opts('ABCDEFGH', (label) => (label === 'A' ? LONG : 'an unusually long description of a historic feature')) },
      questions: range(31, 34).map((q_num) => ({ q_num, prompt: `Place ${q_num}: ${LONG}` })),
    } }, { id: 'p1', exercise_type: 'mcq', payload: {
      template_kind: 'plan_label', instruction: 'Label the plan below. Write the correct letter, A–H.',
      map_image_url: 'https://img.fixture/map.png', metadata: { letter_options: 'ABCDEFGH'.split('') },
      questions: range(35, 38).map((q_num) => ({ q_num, prompt: `${LONG} ${q_num}` })),
    } }],
  ]),
  synthetic('overflow-unbroken', 'Overflow fixture: unbroken long token', [
    [{ id: 'u1', exercise_type: 'dictation', payload: {
      template_kind: 'short_answer', instruction: `Write NO MORE THAN TWO WORDS. Quote ${UNBROKEN} when asked.`,
      questions: [{ q_num: 1, prompt: `What follows ${UNBROKEN}?` }],
    } }, { id: 'u2', exercise_type: 'dictation', payload: {
      template_kind: 'form_completion', instruction: 'Complete the form.',
      questions: [{ q_num: 2, prompt: '' }],
      template: { heading: UNBROKEN, rows: [
        { label: 'Reference', example: UNBROKEN },
        { label: UNBROKEN, q_num: 2, suffix: UNBROKEN },
      ] },
    } }, { id: 'u3', exercise_type: 'dictation', payload: {
      template_kind: 'summary_completion', instruction: 'Complete the summary below.',
      questions: [{ q_num: 3, prompt: '' }],
      template: { paragraph: `The desk code ${UNBROKEN} is printed before {{Q3}}.` },
    } }, { id: 'u4', exercise_type: 'mcq', payload: {
      template_kind: 'mcq_3option', instruction: 'Choose the correct letter, A, B or C.',
      questions: [{ q_num: 4, prompt: `Which code is on ${UNBROKEN}?`, options: opts('ABC', (label) => `${label} ${UNBROKEN}`) }],
    } }],
  ]),
];

function loadFixtures() {
  const fixtures = [...BUILT_IN];
  if (!FIXTURE_DIR) return fixtures;
  for (const file of readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json')).sort()) {
    fixtures.push(JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')));
  }
  return fixtures;
}

function silentWav() {
  const samples = 2000;
  const wav = Buffer.alloc(44 + samples, 128);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples, 40);
  return wav;
}
// 1600×900 grey SVG so plan/map images exercise their own width constraint.
function fixtureImage() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#ccc"/></svg>`);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const cors = {
  'access-control-allow-origin': BASE,
  'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
};

async function launchChromium() {
  try { return await chromium.launch(); } catch (error) {
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome });
    throw error;
  }
}

// Runs in the page. Returns human-readable offences for the active Part.
function measureLayout() {
  const offences = [];
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const label = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ''}`;
  };
  for (const [name, el] of [['document', document.documentElement], ['body', document.body],
    ['shell', document.querySelector('.listening-next-shell')], ['paper', document.querySelector('#listening-paper')]]) {
    if (el && el.scrollWidth > el.clientWidth + 1) offences.push(`${name} scrolls sideways (${el.scrollWidth} > ${el.clientWidth})`);
  }
  const paper = document.querySelector('#listening-paper');
  if (paper) {
    const edge = Math.min(paper.getBoundingClientRect().right, vw);
    const scrollsInline = (el) => {
      for (let node = el.parentElement; node && node !== paper; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll') return true;
      }
      return false;
    };
    const clipped = [];
    for (const el of paper.querySelectorAll('*')) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || rect.right <= edge + 1 || scrollsInline(el)) continue;
      // Report the outermost offender only.
      if (clipped.some((outer) => outer.contains(el))) continue;
      clipped.push(el);
    }
    for (const el of clipped.slice(0, 5)) offences.push(`clipped past paper edge by ${Math.round(el.getBoundingClientRect().right - edge)}px: ${label(el)}`);
    if (clipped.length > 5) offences.push(`…and ${clipped.length - 5} more clipped elements`);
  }
  const controls = [...document.querySelectorAll('.listening-next-palette-label, .listening-next-nav-btn, .listening-next-review, .listening-next-palette .btn-submit-final, .listening-next-topbar button')];
  if (!controls.length) offences.push('no fixed palette controls rendered');
  for (const el of controls) {
    const rect = el.getBoundingClientRect();
    if (rect.left < -1 || rect.top < -1 || rect.right > vw + 1 || rect.bottom > vh + 1 || !rect.width) {
      offences.push(`fixed control outside viewport [${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)}] in ${vw}×${vh}: ${label(el)}`);
      continue;
    }
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!hit || !(el === hit || el.contains(hit))) offences.push(`fixed control covered by ${hit ? label(hit) : 'nothing'}: ${label(el)}`);
  }
  return offences;
}

const fixtures = loadFixtures();
const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
const browser = await launchChromium();
const pageErrors = [];
const unhandledProductionRequests = [];
const unstubbedRequests = [];

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(([key, value]) => {
    try { localStorage.setItem(key, value); } catch (_) {}
    try {
      // Headless Chromium has no audio output; layout, not playback, is under test.
      Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value() { return Promise.resolve(); } });
    } catch (_) {}
  }, [storageKey(SB), fakeSession]);
  const started = new Set();
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === 'https://audio.fixture') return route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav() });
    if (url.origin === 'https://img.fixture') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: fixtureImage() });
    if (request.url().startsWith(BASE) || request.url().startsWith('data:')) return route.continue();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(request.url())) return route.continue();
    if (request.method() === 'POST' && url.pathname === '/api/analytics/events') return route.fulfill({ status: 204, headers: cors });
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: cors });
    if (request.method() === 'GET' && url.pathname === '/auth/me') return json({ id: FAKE_USER_ID, display_name: 'Listening overflow fixture' });
    if (request.method() === 'GET' && url.pathname === '/auth/check-active') return json({ is_active: true }); // W-03 probe
    const previewMatch = url.pathname.match(/^\/admin\/listening\/tests\/([^/]+)\/player-preview$/);
    if (request.method() === 'GET' && previewMatch && byId.has(decodeURIComponent(previewMatch[1]))) return json(byId.get(decodeURIComponent(previewMatch[1])));
    const testMatch = url.pathname.match(/^\/api\/listening\/tests\/([^/]+)$/);
    if (request.method() === 'GET' && testMatch && byId.has(decodeURIComponent(testMatch[1]))) return json(byId.get(decodeURIComponent(testMatch[1])));
    const inProgress = url.pathname.match(/^\/api\/listening\/tests\/([^/]+)\/attempts\/in-progress$/);
    if (request.method() === 'GET' && inProgress) {
      return json({ attempt: started.has(decodeURIComponent(inProgress[1])) ? {
        attempt_id: ATTEMPT_ID, started_at: new Date().toISOString(), renderer_affinity: 'next', answers: [],
      } : null });
    }
    const start = url.pathname.match(/^\/api\/listening\/tests\/([^/]+)\/attempts$/);
    if (request.method() === 'POST' && start) {
      started.add(decodeURIComponent(start[1]));
      return json({ attempt_id: ATTEMPT_ID, status: 'in_progress' });
    }
    if (request.method() === 'POST' && url.pathname === `/api/listening/tests/attempts/${ATTEMPT_ID}/renderer-affinity`) return json({ attempt_id: ATTEMPT_ID, renderer_affinity: 'next' });
    if (request.method() === 'GET' && url.pathname === `/api/listening/tests/attempts/${ATTEMPT_ID}/review-flags`) {
      return json({ attempt_id: ATTEMPT_ID, protocol: 'question-cas-v1', review_flags: [] });
    }
    if (request.url().startsWith(PRODUCTION_BACKEND)) {
      unhandledProductionRequests.push(request.url());
      return route.abort('blockedbyclient');
    }
    // Keep rendering, but fail the run: a new player API needs a deliberate stub.
    unstubbedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
    return json({});
  });

  for (const mode of MODES) for (const fixture of fixtures) {
    started.clear();
    // A fresh tab per paper keeps renderer memory bounded across the matrix.
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.goto(`${BASE}/listening/test/session?id=${encodeURIComponent(fixture.id)}${mode.query}`, { waitUntil: 'domcontentloaded' });
    const bootFailure = async (error) => {
      if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `boot-failure-${fixture.id}-${mode.name.replace(' ', '-')}-${viewport.width}.png`) });
      throw error;
    };
    // The mock embed enters its attempt automatically; the other modes start explicitly.
    if (mode.name === 'student') await page.getByRole('button', { name: 'Start test' }).click().catch(bootFailure);
    await page.getByRole('dialog', { name: 'Check your headphones' }).getByRole('button', { name: /Play$/ }).click().catch(bootFailure);
    await page.locator('#listening-paper .ielts-section').waitFor();
    for (const section of fixture.sections) {
      const partNum = Number(section.section_num);
      await page.locator('.listening-next-palette-label', { hasText: `Part ${partNum}` }).click();
      await page.locator('.listening-next-part-strip strong', { hasText: `Part ${partNum}` }).waitFor();
      await page.locator('#listening-paper .ielts-section-label', { hasText: `PART ${partNum}` }).waitFor();
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));
      const offences = await page.evaluate(measureLayout);
      if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `${fixture.id}-${mode.name.replace(' ', '-')}-${viewport.width}-part${partNum}.png`) });
      check(`${fixture.test_id || fixture.id} ${mode.name} Part ${partNum} @${viewport.width}px has no clipped or covered layout`,
        offences.length === 0, offences.join('; '));
    }
    await page.close();
  }
  await context.close();
}

check('no uncaught browser error', pageErrors.length === 0, pageErrors[0] || '');
check('fixture handles APIs with zero production-backend egress', unhandledProductionRequests.length === 0, unhandledProductionRequests[0] || '');
check('every API request has an explicit fixture stub', unstubbedRequests.length === 0, [...new Set(unstubbedRequests)].join(', '));

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
