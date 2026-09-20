// Hermetic browser regression for the assignment-only Advanced Vocabulary shell.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3000';
const api = new URL(process.env.AVER_API_BASE || 'http://127.0.0.1:3999');
if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname)
    || api.username || api.password || api.pathname !== '/' || api.search || api.hash) {
  throw new Error('AVER_API_BASE must be an explicit local fixture origin');
}
const API = api.origin;
const BANK = '00000000-0000-4000-8000-000000000301';
const ITEM = '00000000-0000-4000-8000-000000000302';
const USER = '00000000-0000-4000-8000-000000000303';
const required = ['vocabulary', 'practice_1', 'practice_2', 'reading', 'controlled_rewrite', 'listening'];

const vocabulary = Array.from({ length: 24 }, (_, index) => ({
  lexeme_id: `word-${index + 1}`,
  headword: `word ${index + 1}`,
  pronunciation: `/wɜːd ${index + 1}/`,
  part_of_speech: 'noun',
  level: 'C1',
  definition_vi: `nghĩa ${index + 1}`,
  definition_en: `Definition ${index + 1}`,
  example: `This is a sufficiently clear example sentence for word ${index + 1}.`,
  collocations: ['fixture collocation'],
  memory_hook: 'A stable browser fixture.',
  common_error: 'Do not use this word with the wrong preposition.',
  audio_headword: '/fixture-audio/headword.mp3',
  audio_example: '/fixture-audio/example.mp3',
}));
const questions = Array.from({ length: 14 }, (_, index) => ({
  question_number: index + 1,
  question_type: 'MCQ',
  stem: `Which statement is supported by paragraph ${index + 1}?`,
  options: ['A stable fixture answer', 'A distractor', 'Another distractor'],
}));
const passages = Array.from({ length: 14 }, (_, index) => ({
  paragraph: String.fromCharCode(65 + index),
  text: `Paragraph ${index + 1}. `.repeat(18),
}));

function payload(mode) {
  const completed = mode === 'review' ? required : mode === 'reading'
    ? ['vocabulary', 'practice_1', 'practice_2'] : [];
  return {
    bank: { id: BANK, code: 'C5-ADV-T01', title: 'Advanced Vocabulary T01' },
    assignment: { item_id: ITEM, due_at: null, accepting: mode !== 'review', submitted_at: mode === 'review' ? '2026-09-16T02:00:00Z' : null, passed_at: mode === 'review' ? '2026-09-16T02:00:00Z' : null },
    lesson: {
      lesson_id: 'ADV-T01', title: 'Family and Upbringing', objectives: [], vocabulary,
      practice: { practice_1: [], practice_2: [] },
      activities: {
        reading: { title: 'A long fixture passage', passages, question_material: [], questions },
        controlled_rewrite: { prompts: [], solutions: [] },
        listening: { questions: [], sections: [] },
        writing: { content: { tasks: {
          task_1: { title: 'Task 1', prompt: [], illustrations: [], prompt_analysis: [], outline: [], model_answers: [] },
          task_2: { title: 'Task 2', prompt: [], prompt_analysis: [], idea_sections: [], outline: [], model_answers: [] },
        }, idea_map: [] } },
        speaking: { content: { blocks: [{ type: 'heading', text: 'Speaking reference' }, { type: 'paragraph', text: 'Example Band 6: A basic answer.' }, { type: 'paragraph', text: 'Band 7: A developed answer.' }, { type: 'paragraph', text: 'Band 8: A nuanced answer.' }] } },
      },
    },
    progress: { completed_stages: completed, stages: [], answers: [], sections: [], listening_submitted: mode === 'review', required_completed: mode === 'review' },
  };
}

async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

const browser = await launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  // The production build owns its CSP. This verifier owns every request and
  // supplies a loopback-only runtime config below, so it can safely exercise
  // an already-built artifact without inheriting a developer's prior config.
  bypassCSP: true,
});
let mode = 'vocabulary';
const requests = [];
const pageErrors = [];
await context.addInitScript({ content: `
window.__AVER_SUPABASE_CLIENT__ = { auth: {
  getSession: async function () { return { data: { session: { access_token: 'fixture-token', user: { id: '${USER}', email: 'learner@local' } } }, error: null }; },
  onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () { return { error: null }; }
} };
` });
await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname) || url.hostname === 'unpkg.com') return route.abort();
  if (url.origin === BASE && url.pathname === '/js/runtime-config.js') {
    return route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.__AVER_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify({
        environment: 'test', apiBase: API,
        supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'test-anon-key',
      })});`,
    });
  }
  if (url.origin === BASE) return route.continue();
  if (url.origin !== API) return route.abort();
  requests.push(`${request.method()} ${url.pathname}`);
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-request-id' };
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
  if (url.pathname === '/auth/me') return json({ id: USER });
  if (request.method() === 'GET' && url.pathname === `/api/advanced-vocab/lessons/${BANK}`) {
    if (mode === 'error') return json({ detail: 'Supabase provider stack secret' }, 500);
    return json(payload(mode));
  }
  return json({ detail: 'No fixture for this request' }, 404);
});

const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(error.message));
const url = `${BASE}/advanced-vocabulary?bank=${BANK}&item=${ITEM}`;

// Vocabulary card parity: click plus Enter/Space, active-face hit testing, 44px audio.
await page.goto(url);
const card = page.locator('.fcs-card');
try {
  await card.waitFor({ timeout: 10_000 });
} catch (error) {
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 1_200);
  throw new Error(`Vocabulary fixture did not render (url=${page.url()}, requests=${requests.join(', ') || 'none'}, pageErrors=${pageErrors.join(' | ') || 'none'}, body=${body || 'empty'})`, { cause: error });
}
await card.focus();
await page.keyboard.press('Space');
if (!(await card.getAttribute('class')).includes('is-flipped')) throw new Error('Space did not flip the vocabulary card');
const frontFacePointerEvents = await page.locator('.fcs-face--front').evaluate((node) => getComputedStyle(node).pointerEvents);
if (frontFacePointerEvents !== 'none') throw new Error('Hidden vocabulary face can intercept active-face controls');
await page.evaluate(() => {
  window.__playedFixtureAudio = '';
  window.Audio = class FixtureAudio {
    constructor(src) { window.__playedFixtureAudio = String(src); }
    play() { return Promise.resolve(); }
  };
});
await page.getByRole('button', { name: 'Nghe ví dụ' }).click();
if (!(await card.getAttribute('class')).includes('is-flipped')) throw new Error('Example audio click flipped the vocabulary card');
const playedFixtureAudio = await page.evaluate(() => window.__playedFixtureAudio);
if (!playedFixtureAudio.endsWith('/fixture-audio/example.mp3')) throw new Error('Example audio control did not play the example recording');
await card.focus();
await page.keyboard.press('Enter');
if ((await card.getAttribute('class')).includes('is-flipped')) throw new Error('Enter did not flip the vocabulary card back');
const audioBox = await page.locator('.fcs-audio').first().boundingBox();
if (!audioBox || audioBox.width < 44 || audioBox.height < 44) throw new Error('Vocabulary audio target is below 44px');

// Reading owns two independent scroll containers and a roving mobile tablist.
mode = 'reading';
await page.reload();
await page.getByRole('heading', { name: 'Reading', exact: true }).waitFor();
const passage = page.locator('.avx-reading-passage');
const questionPane = page.locator('.avx-reading-questions');
await passage.evaluate((node) => { node.scrollTop = 160; });
await questionPane.evaluate((node) => { node.scrollTop = 260; });
const positions = await Promise.all([passage.evaluate((node) => node.scrollTop), questionPane.evaluate((node) => node.scrollTop)]);
if (positions[0] < 100 || positions[1] < 180) throw new Error(`Reading panes did not scroll independently: ${positions}`);
await page.setViewportSize({ width: 390, height: 844 });
const passageTab = page.getByRole('tab', { name: 'Bài đọc' });
await passageTab.focus();
await page.keyboard.press('End');
const questionTab = page.getByRole('tab', { name: /Câu hỏi/ });
if (await questionTab.getAttribute('aria-selected') !== 'true') throw new Error('End did not select the questions tab');
await page.keyboard.press('Home');
if (await passageTab.getAttribute('aria-selected') !== 'true') throw new Error('Home did not restore the passage tab');

// Completed work reopens as reference-only: no writing submit or microphone path.
mode = 'review';
await page.reload();
await page.getByText('Chế độ xem lại').waitFor();
await page.getByText('Nội dung tham khảo — không phải nơi nộp bài').waitFor();
if (await page.locator('textarea').count()) throw new Error('Writing reference unexpectedly renders a submission field');
await page.getByRole('button', { name: /Speaking Lab/ }).click();
await page.getByText('Luyện nói riêng — không chấm mặc định').waitFor();
if (await page.getByRole('button', { name: /ghi âm|micro|nộp bài/i }).count()) throw new Error('Reference-only Speaking exposes a recording/submission control');

// Technical/provider detail is normalized, focused, and recoverable.
mode = 'error';
await page.reload();
const errorHeading = page.getByRole('heading', { name: 'Chưa mở được bài học' });
await errorHeading.waitFor();
if (!(await errorHeading.evaluate((node) => node === document.activeElement))) throw new Error('Load failure did not focus the public error heading');
if ((await page.locator('body').innerText()).includes('Supabase provider stack secret')) throw new Error('Technical provider detail leaked to the learner');
await page.getByRole('button', { name: 'Thử lại' }).waitFor();

const writes = requests.filter((entry) => (entry.startsWith('POST ') || entry.startsWith('PATCH ') || entry.startsWith('DELETE '))
  && entry !== 'POST /api/analytics/events');
if (writes.length) throw new Error(`Reference/browser journey made unexpected writes: ${writes.join(', ')}`);
if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);

console.log('✓ Advanced Vocabulary card, Reading, review-only and error-recovery browser contract');
await browser.close();
