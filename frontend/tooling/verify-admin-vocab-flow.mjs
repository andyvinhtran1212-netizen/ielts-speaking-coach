// Fixture-backed browser contract for native Admin Vocabulary workspaces.
// Production data is never read. Every allowed business write is asserted by
// method, path, body, lock and canonical readback where the backend supports it.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-4000-8000-000000000115';
const learnerId = '10000000-0000-4000-8000-000000000115';
const quizLearnerId = '00000000-0000-4000-8000-000000000301';
const quizBankId = '00000000-0000-4000-8000-000000000302';
const quizBankIdB = '00000000-0000-4000-8000-000000000303';
const contentTopicId = '00000000-0000-4000-8000-000000000401';
const contentTopicIdB = '00000000-0000-4000-8000-000000000404';
const vocabCardId = '00000000-0000-4000-8000-000000000411';
const importedVocabCardId = '00000000-0000-4000-8000-000000000412';
const bulkVocabCardId = '00000000-0000-4000-8000-000000000413';
const staleVocabCardId = '00000000-0000-4000-8000-000000000414';
const fakeSession = JSON.stringify({ access_token: 'admin-vocab-not-a-real-token', refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-vocab@local' } });
const results = [];
const requests = [];
const unexpectedWrites = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launchChromium() { try { return await chromium.launch(); } catch (error) { const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome }); throw error; } }

let vocabRead = 0;
let flagPending = false;
let flagApplied = false;
let holdNextVocab = false;
let heldVocabStarted = false;
let releaseHeldVocab;
let d1Reads = 0;
let d1WritePending = false;
let failNextD1Delete = false;
let lemmaReads = 0;
let lemmaWritePending = false;
let failNextLemmaCreate = false;
let holdNextQuizBankAnalytics = false;
let heldQuizBankAnalyticsStarted = false;
let releaseHeldQuizBankAnalytics;
let holdNextQuizDetail = false;
let heldQuizDetailStarted = false;
let releaseHeldQuizDetail;
let topicReads = 0;
let bundleReads = 0;
let bankReads = 0;
let topicWritePending = false;
let bankWritePending = false;
let importWritePending = false;
let failNextTopicBundle = false;
let contentReads = 0;
let contentDetailReads = 0;
let contentWritePending = false;
let contentImportPending = false;
let failNextContentList = false;
let partialNextContentBulk = false;
let d1Row = {
  id: '00000000-0000-4000-8000-000000000201',
  user_id: '00000000-0000-4000-8000-000000000202',
  vocabulary_id: '00000000-0000-4000-8000-000000000203',
  context_sentence: 'We need to <img onerror=alert(1)> the risk.',
  target_answer: 'mitigate',
  acceptable_variants: [],
  hint: 'reduce',
  source_evidence_substring: 'mitigate the risk',
  generated_by: 'fallback_evidence',
  generated_at: '2026-08-15T00:00:00Z',
  is_active: true,
  attempt_count: 0,
  last_used_at: null,
  created_at: '2026-08-15T00:00:00Z',
  headword: 'mitigate',
};
let lemmaRows = [{ id: '00000000-0000-4000-8000-000000000211', original_word: 'children<script>', lemma: 'child', pos_tag: 'NOUN', notes: 'irregular', created_at: '2026-08-15T00:00:00Z' }];
let topicRow = { id: contentTopicId, slug: 'work-careers', title: 'Work <script>', skill_area: 'vocab', title_vi: null, description: 'Canonical topic', order: 1, is_published: true, created_at: '2026-08-15T00:00:00Z', updated_at: '2026-08-15T00:00:00Z' };
const topicRowB = { id: contentTopicIdB, slug: 'travel', title: 'Travel', skill_area: 'vocab', title_vi: null, description: 'Second topic', order: 2, is_published: true, created_at: '2026-08-15T00:00:00Z', updated_at: '2026-08-15T00:00:00Z' };
let topicBanks = [{ id: quizBankId, topic_id: contentTopicId, code: 'L02', title: null, skill_area: 'vocab', words_count: 20, source: null, version: 1, is_published: true, updated_at: null }];
let vocabDetail = {
  id: vocabCardId,
  slug: 'mitigate',
  headword: 'mitigate<script>',
  category: 'work-careers',
  level: 'B2',
  part_of_speech: 'verb',
  pronunciation: '/ˈmɪtɪɡeɪt/',
  syllables: 'mit-i-gate',
  definition_en: 'make less severe',
  definition_vi: 'giảm nhẹ',
  gloss_vi: 'giảm nhẹ <img onerror=alert(1)>',
  example: 'Trees mitigate heat.',
  register: 'formal',
  common_error: '',
  memory_hook: '',
  source: 'fixture',
  group: 'core',
  body_html: '<p>Canonical body</p>',
  synonyms: ['reduce'],
  antonyms: ['worsen'],
  collocations: ['mitigate risk'],
  related_words: ['mitigation'],
  word_family: [{ word: 'mitigation', pos: 'noun' }],
};
let vocabRows = [{
  id: vocabCardId,
  slug: 'mitigate',
  headword: 'mitigate<script>',
  category: 'work-careers',
  level: 'B2',
  part_of_speech: 'verb',
  pronunciation: '/ˈmɪtɪɡeɪt/',
  gloss_vi: 'giảm nhẹ <img onerror=alert(1)>',
  audio_headword: null,
  audio_example: null,
  audio_status: 'pending',
  updated_at: '2026-08-15T00:00:00Z',
}];
const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch (_) {} }, [storageKey(SB), fakeSession]);
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method(); let body = null;
  try { body = request.postDataJSON?.() ?? null; } catch (_) {}
  requests.push({ method, path: parsed.pathname, search: parsed.search, body });
  const expectedFlag = method === 'POST' && parsed.pathname === `/admin/users/${learnerId}/vocab-flag`;
  const expectedD1 = ['PATCH', 'DELETE'].includes(method) && parsed.pathname === `/admin/vocab/d1-questions/${d1Row.id}`;
  const expectedLemma = (method === 'POST' && parsed.pathname === '/admin/vocab/lemmas/overrides')
    || (method === 'DELETE' && /^\/admin\/vocab\/lemmas\/overrides\/[0-9a-f-]+$/i.test(parsed.pathname));
  const expectedTopic = ['POST'].includes(method) && parsed.pathname === '/admin/content-topics'
    || ['PATCH', 'DELETE'].includes(method) && parsed.pathname === `/admin/content-topics/${contentTopicId}`;
  const expectedBank = ['PATCH', 'DELETE'].includes(method) && parsed.pathname === `/admin/quiz/banks/${quizBankId}`;
  const expectedImport = method === 'POST' && parsed.pathname === '/admin/quiz/import';
  const expectedVocabCard = ['PATCH', 'DELETE'].includes(method) && parsed.pathname === `/admin/vocabulary/${vocabCardId}`;
  const expectedVocabBulk = method === 'POST' && parsed.pathname === '/admin/vocabulary/bulk-delete';
  const expectedVocabAudio = method === 'POST' && parsed.pathname === '/admin/vocabulary/generate-audio';
  const expectedVocabImport = method === 'POST' && parsed.pathname === '/admin/vocabulary/import';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !expectedFlag && !expectedD1 && !expectedLemma && !expectedTopic && !expectedBank && !expectedImport && !expectedVocabCard && !expectedVocabBulk && !expectedVocabAudio && !expectedVocabImport && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) unexpectedWrites.push(`${method} ${parsed.pathname}`);
  const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-vocab@local', role: 'admin' });
  if (method === 'POST' && parsed.pathname === '/admin/vocabulary/import') {
    const dryRun = parsed.searchParams.get('dry_run') === 'true';
    if (!dryRun) { contentImportPending = true; await new Promise((resolve) => setTimeout(resolve, 180)); }
    const result = {
      dry_run: dryRun,
      blocks: [{ index: 0, headword: 'adapt<script>', slug: 'adapt', validation_errors: [], action: dryRun ? null : 'created', db_action: 'created', parsed_data: { category: 'work-careers' } }],
      validation_errors: [],
      committed_ids: dryRun ? [] : ['adapt'],
      duplicate_slugs: [],
      summary: { total: 1, created: dryRun ? 0 : 1, updated: 0, errors: 0, forecast_created: 1, forecast_updated: 0 },
    };
    if (!dryRun) {
      vocabRows = [{ id: importedVocabCardId, slug: 'adapt', headword: 'adapt<script>', category: 'work-careers', level: 'B1', part_of_speech: 'verb', pronunciation: null, gloss_vi: 'thích nghi', audio_headword: null, audio_example: null, audio_status: 'pending', updated_at: null }];
      contentImportPending = false;
    }
    return json(result);
  }
  if (method === 'POST' && parsed.pathname === '/admin/vocabulary/generate-audio') {
    contentWritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    contentWritePending = false;
    return json({ queued_count: body?.ids?.length ?? 0, engine: body?.engine, scope: body?.scope });
  }
  if (method === 'POST' && parsed.pathname === '/admin/vocabulary/bulk-delete') {
    contentWritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    vocabRows = vocabRows.filter((row) => !ids.includes(row.id));
    contentWritePending = false;
    if (partialNextContentBulk) {
      partialNextContentBulk = false;
      return json({ deleted_count: ids.length - 1, not_found: [staleVocabCardId] });
    }
    return json({ deleted_count: ids.length, not_found: [] });
  }
  if (method === 'GET' && parsed.pathname === `/admin/vocabulary/${vocabCardId}`) {
    contentDetailReads += 1;
    return json(vocabDetail);
  }
  if (method === 'PATCH' && parsed.pathname === `/admin/vocabulary/${vocabCardId}`) {
    contentWritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    vocabDetail = { ...vocabDetail, ...body };
    vocabRows = vocabRows.map((row) => row.id === vocabCardId ? { ...row, headword: body?.headword ?? row.headword, category: body?.category ?? row.category, level: body?.level ?? row.level, part_of_speech: body?.part_of_speech ?? row.part_of_speech, pronunciation: body?.pronunciation ?? row.pronunciation, gloss_vi: body?.gloss_vi ?? row.gloss_vi } : row);
    contentWritePending = false;
    return json(vocabDetail);
  }
  if (method === 'DELETE' && parsed.pathname === `/admin/vocabulary/${vocabCardId}`) {
    contentWritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    vocabRows = vocabRows.filter((row) => row.id !== vocabCardId);
    contentWritePending = false;
    return json({ id: vocabCardId, message: 'Vocabulary deleted' });
  }
  if (method === 'GET' && parsed.pathname === '/admin/vocabulary') {
    contentReads += 1;
    if (failNextContentList) { failNextContentList = false; return json({ detail: 'fixture content unavailable' }, 503); }
    const category = parsed.searchParams.get('category') || '';
    const query = (parsed.searchParams.get('q') || '').toLowerCase();
    const offset = Number(parsed.searchParams.get('offset') || 0);
    const limit = Number(parsed.searchParams.get('limit') || 50);
    const filtered = vocabRows.filter((row) => (!category || row.category === category) && (!query || row.headword.toLowerCase().includes(query)));
    return json({ words: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset });
  }
  if (parsed.pathname === '/admin/vocab/stats') {
    vocabRead += 1;
    if (holdNextVocab) {
      holdNextVocab = false;
      heldVocabStarted = true;
      await new Promise((resolve) => { releaseHeldVocab = resolve; });
      return json({ vocab_bank_total: 42, fp_reports_total: 3, fp_rate_percent: 7.1, users_with_vocab_enabled: 7 });
    }
    return json({ vocab_bank_total: 42, fp_reports_total: 3, fp_rate_percent: 7.1, users_with_vocab_enabled: flagApplied ? 8 : 7 });
  }
  if (parsed.pathname === '/admin/flashcards/stats') return json({
    stats: {
      activity: { total_manual_stacks: 5, total_cards_in_manual_stacks: 42, total_active_users: 2, total_reviews_all_time: 20 },
      srs_health: { rating_distribution_percent: { again: 10, hard: 20, good: 50, easy: 20 }, rating_total_count: 10, avg_ease_factor: 2.4, cards_mastered_30plus_days: 8, cards_with_lapses: 3 },
      engagement: { avg_reviews_per_user_last_7_days: 4.5, avg_dau_last_30_days: 2.2, top_reviewed_words: [{ headword: 'mitigate<script>', review_count: 9 }] },
      timeseries: [{ date: '2026-08-15', reviews: 3 }],
    }, period_days: Number(parsed.searchParams.get('days')), computed_at: '2026-08-15T12:00:00Z',
  });
  if (expectedFlag) {
    flagPending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    flagApplied = true;
    flagPending = false;
    return json({ ok: true, message: 'Vocab bank enabled.' });
  }
  if (method === 'GET' && parsed.pathname === '/admin/vocab/d1-questions') {
    d1Reads += 1;
    const active = parsed.searchParams.get('active');
    const visible = active === 'true' ? d1Row.is_active : active === 'false' ? !d1Row.is_active : true;
    return json({ items: visible ? [d1Row] : [], total: visible ? 1 : 0, offset: Number(parsed.searchParams.get('offset') || 0), limit: Number(parsed.searchParams.get('limit') || 50) });
  }
  if (expectedD1 && method === 'PATCH') {
    d1WritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    d1Row = { ...d1Row, context_sentence: body?.context_sentence ?? d1Row.context_sentence, target_answer: body?.target_answer ?? d1Row.target_answer, hint: body?.hint ?? d1Row.hint, is_active: body?.is_active ?? d1Row.is_active };
    d1WritePending = false;
    return json({ ok: true, id: d1Row.id, updated_fields: Object.keys(body || {}) });
  }
  if (expectedD1 && method === 'DELETE') {
    d1WritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    if (failNextD1Delete) { failNextD1Delete = false; d1WritePending = false; return json({ detail: 'fixture archive rejected' }, 409); }
    d1Row = { ...d1Row, is_active: false };
    d1WritePending = false;
    return route.fulfill({ status: 204, body: '' });
  }
  if (method === 'GET' && parsed.pathname === '/admin/vocab/lemmas/overrides') {
    lemmaReads += 1;
    const search = (parsed.searchParams.get('search') || '').toLowerCase();
    const visible = lemmaRows.filter((row) => row.original_word.toLowerCase().startsWith(search));
    return json({ items: visible, total: visible.length, offset: Number(parsed.searchParams.get('offset') || 0), limit: Number(parsed.searchParams.get('limit') || 100) });
  }
  if (expectedLemma && method === 'POST') {
    lemmaWritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    if (failNextLemmaCreate) { failNextLemmaCreate = false; lemmaWritePending = false; return json({ detail: 'fixture duplicate override' }, 409); }
    const item = { id: '00000000-0000-4000-8000-000000000212', original_word: body?.original_word, lemma: body?.lemma, pos_tag: body?.pos_tag, notes: body?.notes, created_at: '2026-08-15T01:00:00Z' };
    lemmaRows = [item, ...lemmaRows];
    lemmaWritePending = false;
    return json({ ok: true, item }, 201);
  }
  if (expectedLemma && method === 'DELETE') {
    lemmaWritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    const id = parsed.pathname.split('/').pop();
    lemmaRows = lemmaRows.filter((row) => row.id !== id);
    lemmaWritePending = false;
    return route.fulfill({ status: 204, body: '' });
  }
  if (method === 'GET' && parsed.pathname === '/admin/content-topics') {
    topicReads += 1;
    return json(parsed.searchParams.get('skill_area') === 'vocab' ? [topicRow, topicRowB] : []);
  }
  if (method === 'GET' && parsed.pathname === `/admin/content-topics/${contentTopicIdB}/bundle`) {
    bundleReads += 1;
    if (failNextTopicBundle) { failNextTopicBundle = false; return json({ detail: 'fixture bundle unavailable' }, 503); }
    return json({ topic: topicRowB, vocab_cards: [], quiz_banks: [], counts: { vocab_cards: 0, quiz_banks: 0 } });
  }
  if (method === 'GET' && parsed.pathname === `/admin/content-topics/${contentTopicId}/bundle`) {
    bundleReads += 1;
    return json({
      topic: topicRow,
      vocab_cards: [{ id: '00000000-0000-4000-8000-000000000402', slug: 'mitigate', headword: 'mitigate<img>', category: 'work-careers', level: null, part_of_speech: null, audio_status: null, updated_at: null }],
      quiz_banks: topicBanks.map(({ topic_id: _topicId, source: _source, version: _version, updated_at: _updatedAt, ...bank }) => bank),
      counts: { vocab_cards: 1, quiz_banks: topicBanks.length },
    });
  }
  if (expectedTopic && method === 'PATCH') {
    topicWritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    topicRow = { ...topicRow, title: body?.title ?? topicRow.title, title_vi: body?.title_vi ?? null, description: body?.description ?? null, order: body?.order ?? topicRow.order, is_published: body?.is_published ?? topicRow.is_published };
    topicWritePending = false;
    return json(topicRow);
  }
  if (expectedBank && method === 'PATCH') {
    bankWritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    topicBanks = topicBanks.map((bank) => bank.id === quizBankId ? { ...bank, is_published: body?.is_published ?? bank.is_published } : bank);
    bankWritePending = false;
    return json(topicBanks.find((bank) => bank.id === quizBankId));
  }
  if (expectedBank && method === 'DELETE') {
    bankWritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    topicBanks = topicBanks.filter((bank) => bank.id !== quizBankId);
    bankWritePending = false;
    return json({ id: quizBankId, deleted: true });
  }
  if (expectedImport) {
    const dryRun = parsed.searchParams.get('dry_run') === 'true';
    if (!dryRun) { importWritePending = true; await new Promise((resolve) => setTimeout(resolve, 180)); }
    const result = {
      dry_run: dryRun,
      meta: { code: 'L02', title: 'Grammar 2 <script>', skill_area: 'vocab' },
      questions: [
        { index: 1, qid: 'L02-Q1', item_key: 'mitigate', type: 'mcq', skill: 'meaning', validation_errors: [] },
        { index: 2, qid: 'L02-Q2', item_key: 'mitigate', type: 'gap_text', skill: 'production', validation_errors: [] },
      ], validation_errors: [],
      summary: { words: 20, questions: 2, errors: 0, pools: 1 },
      committed_bank_id: dryRun ? null : quizBankId,
    };
    if (!dryRun) {
      topicBanks = [{ id: quizBankId, topic_id: contentTopicId, code: 'L02', title: 'Grammar 2 <script>', skill_area: 'vocab', words_count: 20, source: null, version: 2, is_published: true, updated_at: null }];
      importWritePending = false;
    }
    return json(result);
  }
  if (method === 'GET' && parsed.pathname === '/admin/quiz/students') {
    const course = parsed.searchParams.get('skill_area') === 'course';
    return json({
      overview: { active_learners: 1, total_sessions: 2, total_time_sec: 125, total_words_mastered: course ? 0 : 8, avg_accuracy: 0.75 },
      students: [{ user_id: quizLearnerId, name: 'Lan <img onerror=alert(1)>', email: 'lan@example.test', sessions: 2, graded_sessions: 1, time_sec: 125, avg_accuracy: 0.75, words_mastered: course ? 0 : 8, last_active: '2026-08-15T00:00:00Z' }],
    });
  }
  if (method === 'GET' && parsed.pathname === `/admin/quiz/students/${quizLearnerId}`) {
    if (holdNextQuizDetail) {
      holdNextQuizDetail = false;
      heldQuizDetailStarted = true;
      await new Promise((resolve) => { releaseHeldQuizDetail = resolve; });
    }
    return json({
      user: { user_id: quizLearnerId, name: 'Lan <img onerror=alert(1)>', email: 'lan@example.test' },
      banks: [{ bank_id: quizBankId, code: 'L02', title: 'Grammar 2', skill_area: 'vocab', words_count: 20, mastered: 6, in_progress: 2 }],
      recent_sessions: [{ code: 'L02', accuracy: null, words_mastered: 0, total_questions: 0, total_correct: 0, duration_sec: null, ended_at: null, ended_by: null }],
    });
  }
  if (method === 'GET' && parsed.pathname === '/admin/quiz/banks') { bankReads += 1; return json(parsed.searchParams.get('skill_area') === 'vocab' ? topicBanks : []); }
  if (method === 'GET' && parsed.pathname === `/admin/quiz/banks/${quizBankId}/analytics`) {
    if (holdNextQuizBankAnalytics) {
      holdNextQuizBankAnalytics = false;
      heldQuizBankAnalyticsStarted = true;
      await new Promise((resolve) => { releaseHeldQuizBankAnalytics = resolve; });
    }
    return json({ session_count: 2, items: [{ item_key: 'mitigate<script>', total: 4, wrong: 1, error_rate: 0.25 }], skills: [{ skill: 'meaning', total: 4, wrong: 1, error_rate: 0.25 }] });
  }
  if (method === 'GET' && parsed.pathname === `/admin/quiz/banks/${quizBankIdB}/analytics`) return json({ session_count: 1, items: [{ item_key: 'resilient', total: 2, wrong: 1, error_rate: 0.5 }], skills: [{ skill: 'spelling', total: 2, wrong: 1, error_rate: 0.5 }] });
  return json({});
});

await page.goto(`${BASE}/admin/vocab`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Vocabulary workspace', exact: true }).waitFor();
check('hub qua backend-owned admin gate', requests.some((item) => item.path === '/auth/me'));
check('hub có đủ tám workspace và canonical links', await page.locator('a.avv-card').count() === 8
  && await page.getByRole('link', { name: /Xem phía học viên/ }).getAttribute('href') === '/vocabulary/hub'
  && await page.locator('a.avv-card[href="/admin/vocab/topics"]').count() === 1
  && await page.locator('a.avv-card[href="/admin/vocab/quiz"]').count() === 1
  && await page.getByRole('link', { name: /Kết quả Quick-Check/ }).getAttribute('href') === '/admin/vocab/quiz-analytics'
  && await page.getByRole('link', { name: /D1 Curation/ }).getAttribute('href') === '/admin/vocab/d1-curation'
  && await page.getByRole('link', { name: /Lemma Overrides/ }).getAttribute('href') === '/admin/vocab/lemmas'
  && await page.getByRole('link', { name: /Nội dung từ vựng/ }).getAttribute('href') === '/admin/vocab/content');
check('mobile hub một cột, không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.avv-grid')).gridTemplateColumns.split(' ').length === 1 && document.documentElement.scrollWidth <= window.innerWidth));

await page.goto(`${BASE}/admin/vocab/stats?days=7`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Vocab + Flashcards Stats', exact: true }).waitFor();
await page.getByText('42', { exact: true }).first().waitFor();
check('đọc hai canonical aggregate contract', requests.some((item) => item.path === '/admin/vocab/stats') && requests.some((item) => item.path === '/admin/flashcards/stats' && item.search === '?days=7'));
check('render key backend thật, không dùng field legacy stale', await page.getByText('Manual stacks', { exact: true }).count() === 1 && await page.getByText('Lifetime reviews', { exact: true }).count() === 1 && await page.getByText('20', { exact: true }).count() >= 1);
check('React escape dữ liệu headword độc hại', await page.getByText('mitigate<script>', { exact: true }).count() === 1 && await page.locator('.avv-stats-shell script, .avv-stats-shell img').count() === 0);
await page.getByLabel('Khoảng thời gian').selectOption('90');
await page.waitForResponse((response) => new URL(response.url()).pathname === '/admin/flashcards/stats' && new URL(response.url()).search === '?days=90').catch(() => null);
check('period bền trong URL và canonical request', new URL(page.url()).searchParams.get('days') === '90' && requests.some((item) => item.path === '/admin/flashcards/stats' && item.search === '?days=90'));

await page.getByLabel('User ID').fill('not-a-uuid');
await page.getByRole('button', { name: 'Bật Vocab' }).click();
check('UUID sai bị chặn trước network', await page.getByText('User ID phải là UUID hợp lệ.', { exact: true }).count() === 1 && !requests.some((item) => item.path.includes('not-a-uuid')));
await page.getByLabel('User ID').fill(learnerId);
holdNextVocab = true;
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.waitForTimeout(40);
check('refresh cũ đang được giữ để kiểm freshness', heldVocabStarted);
await page.getByRole('button', { name: 'Bật Vocab' }).click();
await page.waitForTimeout(40);
check('mutation bị khoá trong lúc chờ ACK', flagPending && await page.getByRole('button', { name: 'Bật Vocab' }).isDisabled() && await page.getByRole('button', { name: 'Tắt Vocab' }).isDisabled());
await page.getByText('Vocab bank enabled.', { exact: true }).waitFor();
check('mutation đúng path/body và đọc lại canonical Vocab stats', requests.some((item) => item.method === 'POST' && item.path === `/admin/users/${learnerId}/vocab-flag` && item.body?.enabled === true) && vocabRead >= 2);
releaseHeldVocab?.();
await page.waitForTimeout(100);
check('refresh cũ không ghi đè canonical flag readback', await page.getByText('8', { exact: true }).count() >= 1);
check('stats mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

await page.goto(`${BASE}/admin/vocab/d1-curation`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'D1 Curation', exact: true }).waitFor();
await page.getByText('mitigate', { exact: true }).first().waitFor();
check('D1 đọc đúng canonical filter mặc định', requests.some((item) => item.path === '/admin/vocab/d1-questions' && item.search === '?active=true&offset=0&limit=50'));
check('D1 escape context độc hại', await page.getByText('We need to <img onerror=alert(1)> the risk.', { exact: true }).count() === 1 && await page.locator('.avv-console-shell img').count() === 0);
await page.getByLabel('User ID').fill('not-a-uuid');
await page.getByRole('button', { name: 'Tìm kiếm' }).click();
check('D1 chặn user UUID sai trước network', await page.getByText('User ID phải là UUID hợp lệ.', { exact: true }).count() === 1 && !requests.some((item) => item.search.includes('not-a-uuid')));
await page.getByRole('button', { name: 'Reset' }).click();
await page.getByText('mitigate', { exact: true }).first().waitFor();
await page.getByRole('button', { name: 'Sửa' }).click();
await page.getByLabel('Target answer').fill('reduce');
await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
await page.waitForTimeout(40);
check('D1 khoá edit trong lúc chờ ACK', d1WritePending && await page.getByRole('button', { name: 'Đang xác minh…' }).isDisabled());
check('D1 khoá filter để readback không lệch URL', await page.getByLabel('Source').isDisabled() && await page.getByLabel('Trạng thái').isDisabled() && await page.getByRole('button', { name: 'Reset' }).isDisabled());
await page.getByText('Đã lưu và tải lại danh sách D1 chuẩn từ backend.', { exact: true }).waitFor();
check('D1 PATCH đúng body và canonical readback', requests.some((item) => item.method === 'PATCH' && item.path === `/admin/vocab/d1-questions/${d1Row.id}` && item.body?.context_sentence === 'We need to <img onerror=alert(1)> the risk.' && item.body?.target_answer === 'reduce' && item.body?.hint === 'reduce') && d1Reads >= 3);
await page.getByRole('button', { name: 'Archive' }).click();
const d1Dialog = page.getByRole('dialog', { name: 'Archive câu hỏi D1?' });
failNextD1Delete = true;
await d1Dialog.getByRole('button', { name: 'Archive', exact: true }).click();
await page.waitForTimeout(40);
check('D1 khoá archive trong lúc chờ backend', d1WritePending && await d1Dialog.getByRole('button', { name: 'Đang xác minh…' }).isDisabled());
await d1Dialog.getByRole('alert').waitFor();
check('D1 hiện lỗi archive ngay trong dialog', await d1Dialog.getByRole('alert').getByText(/Không xác nhận được trạng thái archive/).count() === 1);
await d1Dialog.getByRole('button', { name: 'Archive', exact: true }).click();
await page.getByText('Đã archive và tải lại danh sách D1 chuẩn từ backend.', { exact: true }).waitFor();
check('D1 DELETE giữ soft-delete truth qua readback', requests.some((item) => item.method === 'DELETE' && item.path === `/admin/vocab/d1-questions/${d1Row.id}`) && d1Row.is_active === false && d1Reads >= 4);
check('D1 mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

await page.goto(`${BASE}/admin/vocab/lemmas`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Lemma Overrides', exact: true }).waitFor();
await page.getByText('children<script>', { exact: true }).waitFor();
check('Lemma đọc canonical list và escape dữ liệu', requests.some((item) => item.path === '/admin/vocab/lemmas/overrides' && item.search === '?offset=0&limit=100') && await page.locator('.avv-console-shell script').count() === 0);
await page.getByLabel('Tìm original word').fill('child');
await page.getByRole('button', { name: 'Tìm', exact: true }).click();
await page.waitForTimeout(80);
check('Lemma prefix search bền trong URL/request', new URL(page.url()).searchParams.get('search') === 'child' && requests.some((item) => item.path === '/admin/vocab/lemmas/overrides' && item.search === '?search=child&offset=0&limit=100'));
await page.getByRole('button', { name: '+ Thêm override', exact: true }).click();
const lemmaCreateDialog = page.getByRole('dialog', { name: 'Thêm lemma override' });
await lemmaCreateDialog.getByRole('button', { name: 'Lưu override' }).click();
check('Lemma hiện validation ngay trong modal', await lemmaCreateDialog.getByRole('alert').getByText('Original word và lemma không được trống.', { exact: true }).count() === 1);
await lemmaCreateDialog.getByLabel('Original word', { exact: true }).fill('mice');
await lemmaCreateDialog.getByLabel('Lemma (canonical form)', { exact: true }).fill('mouse');
await lemmaCreateDialog.locator('select').selectOption('NOUN');
await lemmaCreateDialog.getByLabel('Notes (tuỳ chọn)', { exact: true }).fill('irregular plural');
failNextLemmaCreate = true;
await lemmaCreateDialog.getByRole('button', { name: 'Lưu override' }).click();
await page.waitForTimeout(40);
check('Lemma khoá create trong lúc chờ ACK', lemmaWritePending && await page.getByRole('button', { name: 'Đang xác minh…' }).isDisabled());
await lemmaCreateDialog.getByRole('alert').waitFor();
check('Lemma hiện lỗi backend ngay trong modal', await lemmaCreateDialog.getByRole('alert').getByText(/Không xác nhận được trạng thái override/).count() === 1);
await lemmaCreateDialog.getByRole('button', { name: 'Lưu override' }).click();
await page.getByText('Đã tạo override và tải lại danh sách chuẩn từ backend.', { exact: true }).waitFor();
check('Lemma POST đúng body và canonical readback', requests.some((item) => item.method === 'POST' && item.path === '/admin/vocab/lemmas/overrides' && item.body?.original_word === 'mice' && item.body?.lemma === 'mouse' && item.body?.pos_tag === 'NOUN' && item.body?.notes === 'irregular plural') && lemmaReads >= 3);
await page.getByRole('button', { name: 'Xoá', exact: true }).click();
const lemmaDialog = page.getByRole('dialog', { name: 'Xoá override?' });
await lemmaDialog.getByRole('button', { name: 'Xoá override' }).click();
await page.waitForTimeout(40);
check('Lemma khoá delete trong lúc chờ backend', lemmaWritePending && await lemmaDialog.getByRole('button', { name: 'Đang xác minh…' }).isDisabled());
await page.getByText('Đã xoá override và tải lại danh sách chuẩn từ backend.', { exact: true }).waitFor();
check('Lemma DELETE đúng id và canonical readback', requests.some((item) => item.method === 'DELETE' && item.path === '/admin/vocab/lemmas/overrides/00000000-0000-4000-8000-000000000211') && lemmaReads >= 4);
check('Lemma mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

await page.goto(`${BASE}/admin/vocab/topics?topic=${contentTopicId}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Chủ đề nội dung', exact: true }).waitFor();
await page.getByText('Work <script>', { exact: true }).first().waitFor();
await page.locator('.avv-topic-form').waitFor();
check('Topics chỉ nhận deep-link sau scoped canonical list', requests.findIndex((item) => item.path === '/admin/content-topics' && item.search === '?skill_area=vocab') < requests.findIndex((item) => item.path === `/admin/content-topics/${contentTopicId}/bundle`) && new URL(page.url()).searchParams.get('topic') === contentTopicId);
check('Topics escape title/card độc hại', await page.locator('.avv-topic-console script, .avv-topic-console img').count() === 0);
failNextTopicBundle = true;
await page.getByRole('button', { name: /Travel/ }).click();
await page.getByRole('alert').getByText(/Không tải được topic/).waitFor();
check('Topics không hiện form cũ khi bundle topic mới lỗi', new URL(page.url()).searchParams.get('topic') === contentTopicIdB && await page.locator('.avv-topic-form').count() === 0 && await page.getByRole('button', { name: 'Xoá topic' }).count() === 0);
await page.getByRole('button', { name: /Work <script>/ }).click();
await page.locator('.avv-topic-form').waitFor();
await page.getByLabel('Tên', { exact: true }).fill('Work & Careers');
await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
await page.waitForTimeout(40);
check('Topic form khoá trong lúc chờ ACK', topicWritePending && await page.getByRole('button', { name: 'Đang xác minh…' }).first().isDisabled());
await page.getByText('Đã lưu topic và đọc lại canonical bundle.', { exact: true }).waitFor();
check('Topic PATCH đúng body và canonical list/bundle readback', requests.some((item) => item.method === 'PATCH' && item.path === `/admin/content-topics/${contentTopicId}` && item.body?.title === 'Work & Careers') && topicReads >= 2 && bundleReads >= 2);
await page.getByRole('button', { name: 'Ẩn', exact: true }).click();
await page.waitForTimeout(40);
check('Bank publish bị khoá khi chờ ACK', bankWritePending && await page.getByRole('button', { name: 'Đang xác minh…' }).first().isDisabled());
await page.getByText('Đã đổi trạng thái bank và đọc lại canonical bundle.', { exact: true }).waitFor();
check('Bank PATCH đúng và canonical bundle phản ánh hidden', requests.some((item) => item.method === 'PATCH' && item.path === `/admin/quiz/banks/${quizBankId}` && item.body?.is_published === false) && await page.getByText('hidden', { exact: true }).count() >= 1);
await page.getByRole('button', { name: 'Phân tích' }).click();
await page.getByText('mitigate<script>', { exact: true }).waitFor();
check('Topics analytics escape item độc hại', await page.locator('.avv-inline-analytics script, .avv-inline-analytics img').count() === 0);
check('Topics mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

await page.goto(`${BASE}/admin/vocab/quiz?topic=${contentTopicId}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Quick‑Check Quiz', exact: true }).waitFor();
await page.getByText('L02', { exact: true }).first().waitFor();
check('Quiz deep-link được scoped topic list xác nhận', await page.getByLabel('Chủ đề (topic)').inputValue() === contentTopicId && requests.some((item) => item.path === '/admin/content-topics' && item.search === '?skill_area=vocab'));
await page.locator('input[type=file]').setInputFiles({ name: 'L02.md', mimeType: 'text/markdown', buffer: Buffer.from('---\nkind: quiz\n---\n') });
await page.getByText('Không có lỗi validation. Chọn đúng topic và lưu khi sẵn sàng.', { exact: true }).waitFor();
check('Quiz dry-run gọi multipart không commit', requests.some((item) => item.method === 'POST' && item.path === '/admin/quiz/import' && item.search.includes('dry_run=true')) && await page.getByText('Grammar 2 <script>', { exact: true }).count() === 1 && await page.locator('.avv-quiz-import script').count() === 0);
await page.getByRole('button', { name: 'Lưu vào hệ thống' }).click();
await page.waitForTimeout(40);
check('Quiz commit khoá nút khi chờ ACK', importWritePending && await page.getByRole('button', { name: 'Đang xác minh…' }).isDisabled());
await page.getByText('Đã lưu bank L02 và đọc lại canonical list.', { exact: true }).waitFor();
check('Quiz commit một lần và canonical bank readback', requests.filter((item) => item.method === 'POST' && item.path === '/admin/quiz/import' && item.search.includes('dry_run=false')).length === 1 && bankReads >= 2);
const committedButton = page.getByRole('button', { name: 'Lưu vào hệ thống' });
check('Quiz giữ commit disabled sau canonical success', await committedButton.isDisabled());
await committedButton.evaluate((button) => button.click());
await page.waitForTimeout(80);
check('Quiz click lặp không gửi commit write thứ hai', requests.filter((item) => item.method === 'POST' && item.path === '/admin/quiz/import' && item.search.includes('dry_run=false')).length === 1);
await page.getByRole('button', { name: 'Xoá', exact: true }).click();
const bankDeleteDialog = page.getByRole('dialog', { name: 'Xoá Quick‑Check bank?' });
await bankDeleteDialog.getByRole('button', { name: 'Xoá bank' }).click();
await page.waitForTimeout(40);
check('Quiz delete khoá dialog khi chờ ACK', bankWritePending && await bankDeleteDialog.getByRole('button', { name: 'Đang xác minh…' }).isDisabled());
await page.getByText('Đã xoá bank và đọc lại canonical list.', { exact: true }).waitFor();
check('Quiz delete xác minh canonical absence', requests.some((item) => item.method === 'DELETE' && item.path === `/admin/quiz/banks/${quizBankId}`) && topicBanks.length === 0);
check('Quiz mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

// Restore canonical banks for the independent read-only Analytics route below.
topicBanks = [
  { id: quizBankId, topic_id: contentTopicId, code: 'L02', title: null, skill_area: 'vocab', words_count: 20, source: null, version: 1, is_published: true, updated_at: null },
  { id: quizBankIdB, topic_id: contentTopicId, code: 'L03', title: 'Grammar 3', skill_area: 'vocab', words_count: 20, source: null, version: 1, is_published: true, updated_at: null },
];
const analyticsRequestStart = requests.length;
await page.goto(`${BASE}/admin/vocab/quiz-analytics?scope=vocab&tab=hard&bank_id=${quizBankId}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Kết quả luyện tập từ vựng', exact: true }).waitFor();
await page.getByText('mitigate<script>', { exact: true }).waitFor();
const analyticsRequests = requests.slice(analyticsRequestStart);
check('Analytics deep-link chỉ tải bank sau scoped canonical list', analyticsRequests.findIndex((item) => item.path === '/admin/quiz/banks' && item.search === '?skill_area=vocab') < analyticsRequests.findIndex((item) => item.path === `/admin/quiz/banks/${quizBankId}/analytics`));
check('Analytics giữ scope/tab/bank hợp lệ trong URL', new URL(page.url()).searchParams.get('scope') === 'vocab' && new URL(page.url()).searchParams.get('tab') === 'hard' && new URL(page.url()).searchParams.get('bank_id') === quizBankId);
check('Analytics escape dữ liệu item độc hại', await page.getByText('mitigate<script>', { exact: true }).count() === 1 && await page.locator('.avv-quiz-analytics script, .avv-quiz-analytics img').count() === 0);
await page.getByLabel('Chọn bộ').selectOption('');
holdNextQuizBankAnalytics = true;
await page.getByLabel('Chọn bộ').selectOption(quizBankId);
await page.waitForTimeout(40);
check('Analytics bank A được giữ để kiểm freshness', heldQuizBankAnalyticsStarted);
await page.getByLabel('Chọn bộ').selectOption(quizBankIdB);
await page.getByText('resilient', { exact: true }).waitFor();
releaseHeldQuizBankAnalytics?.();
await page.waitForTimeout(100);
check('Analytics request bank cũ không ghi đè bank mới', new URL(page.url()).searchParams.get('bank_id') === quizBankIdB && await page.getByText('resilient', { exact: true }).count() === 1 && await page.getByText('mitigate<script>', { exact: true }).count() === 0);
await page.getByRole('tab', { name: 'Theo học viên' }).click();
await page.getByText('Lan <img onerror=alert(1)>', { exact: true }).waitFor();
check('Analytics đọc rollup canonical và escape identity', requests.some((item) => item.path === '/admin/quiz/students' && item.search === '?skill_area=vocab') && await page.locator('.avv-quiz-analytics img').count() === 0);
holdNextQuizDetail = true;
await page.getByRole('button', { name: 'Xem chi tiết' }).click();
await page.waitForTimeout(40);
check('Analytics detail được giữ để kiểm close freshness', heldQuizDetailStarted);
await page.keyboard.press('Escape');
releaseHeldQuizDetail?.();
await page.waitForTimeout(100);
check('Analytics detail cũ không mở lại dialog đã đóng', await page.getByRole('dialog').count() === 0);
await page.getByRole('button', { name: 'Xem chi tiết' }).click();
const quizDialog = page.getByRole('dialog', { name: 'Lan <img onerror=alert(1)>' });
await quizDialog.getByText('0s', { exact: true }).waitFor();
check('Analytics drill-down giữ session duration null dưới dạng 0s', requests.some((item) => item.path === `/admin/quiz/students/${quizLearnerId}` && item.search === '?skill_area=vocab') && await quizDialog.getByText('0s', { exact: true }).count() === 1);
await page.keyboard.press('Escape');
check('Analytics dialog đóng bằng Escape', await page.getByRole('dialog').count() === 0);
await page.getByLabel('Phạm vi').selectOption('course');
await page.getByRole('heading', { name: 'Kết quả bài tập theo buổi', exact: true }).waitFor();
await page.getByText('Phiên đã chấm', { exact: true }).waitFor();
check('Analytics đổi toàn bộ rollup sang course scope', requests.some((item) => item.path === '/admin/quiz/students' && item.search === '?skill_area=course') && !new URL(page.url()).searchParams.has('bank_id'));
check('Analytics mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

const contentRequestStart = requests.length;
await page.goto(`${BASE}/admin/vocab/content?category=unknown-topic&q=mitigate`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Kho từ vựng', exact: true }).waitFor();
await page.getByText('mitigate<script>', { exact: true }).first().waitFor();
const contentRequests = requests.slice(contentRequestStart);
check('Content chỉ admit category qua scoped topic list', contentRequests.findIndex((item) => item.path === '/admin/content-topics' && item.search === '?skill_area=vocab') < contentRequests.findIndex((item) => item.path === '/admin/vocabulary') && !new URL(page.url()).searchParams.has('category'));
check('Content giữ query hợp lệ và phân trang canonical', new URL(page.url()).searchParams.get('q') === 'mitigate' && contentRequests.some((item) => item.path === '/admin/vocabulary' && item.search === '?limit=50&offset=0&q=mitigate'));
check('Content escape dữ liệu độc hại', await page.locator('.avv-content-console script, .avv-content-console img').count() === 0);
check('Content import mở sẵn nhưng admin vẫn có thể đóng', await page.locator('details.avv-content-import').evaluate((node) => node.open));

await page.getByLabel('Chọn mitigate<script>').check();
failNextContentList = true;
await page.locator('.avv-content-filters > label select').selectOption('travel');
await page.getByText(/Không tải được kho từ/).waitFor();
check('Content xoá dữ liệu và selection cũ khi filtered GET lỗi', await page.getByText('mitigate<script>', { exact: true }).count() === 0 && await page.getByRole('button', { name: 'Xoá (0)' }).isDisabled());
await page.locator('.avv-content-filters > label select').selectOption('');
await page.getByText('mitigate<script>', { exact: true }).first().waitFor();

await page.getByLabel('Tìm headword').fill('');
await page.getByRole('button', { name: 'Tìm', exact: true }).click();
await page.getByText('mitigate<script>', { exact: true }).first().waitFor();
await page.getByRole('button', { name: 'Sửa', exact: true }).click();
const contentEditDialog = page.getByRole('dialog', { name: 'Hiệu chỉnh vocab card' });
await contentEditDialog.waitFor();
await contentEditDialog.getByLabel('Headword', { exact: true }).fill('mitigate safely');
const wordFamilyValue = await contentEditDialog.locator('textarea.is-code').first().inputValue();
check('Content editor giữ rich word-family JSON', wordFamilyValue.includes('"word": "mitigation"') && !wordFamilyValue.includes('[object Object]'));
await contentEditDialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
await page.waitForTimeout(40);
check('Content PATCH bị khoá trong lúc chờ ACK', contentWritePending && await contentEditDialog.getByRole('button', { name: 'Đang xác minh…' }).isDisabled());
await page.getByText('Đã lưu và đọc lại vocab card chuẩn từ backend.', { exact: true }).waitFor();
check('Content PATCH đúng body, giữ object word-family và canonical readback', requests.some((item) => item.method === 'PATCH' && item.path === `/admin/vocabulary/${vocabCardId}` && item.body?.headword === 'mitigate safely' && item.body?.word_family?.[0]?.word === 'mitigation') && contentDetailReads >= 2 && contentReads >= 2);

await page.getByLabel('Chọn mitigate safely').check();
await page.getByLabel('Engine audio').selectOption('elevenlabs');
await page.getByRole('button', { name: 'Tạo audio (1)' }).click();
const audioDialog = page.getByRole('dialog', { name: 'Tạo 1 audio bằng ElevenLabs?' });
check('Content cảnh báo chi phí trước ElevenLabs write', await audioDialog.getByText('Chi phí bên thứ ba', { exact: true }).count() === 1);
await audioDialog.getByRole('button', { name: 'Hủy' }).click();
await page.getByLabel('Engine audio').selectOption('openai');
await page.getByRole('button', { name: 'Tạo audio (1)' }).click();
await page.waitForTimeout(40);
check('Content audio write bị khoá khi chờ ACK', contentWritePending && await page.getByRole('button', { name: 'Tạo audio (1)' }).isDisabled());
await page.getByText(/Đã xếp hàng 1 từ qua openai/).waitFor();
check('Content audio gửi đúng engine/scope/selection', requests.some((item) => item.method === 'POST' && item.path === '/admin/vocabulary/generate-audio' && item.body?.ids?.[0] === vocabCardId && item.body?.engine === 'openai' && item.body?.scope === 'both' && item.body?.skip_existing_audio === true));

const contentRow = page.locator('tbody tr').filter({ hasText: 'mitigate safely' });
await contentRow.getByRole('button', { name: 'Xoá', exact: true }).click();
const contentDeleteDialog = page.getByRole('dialog', { name: 'Xoá “mitigate safely”?' });
await contentDeleteDialog.getByRole('button', { name: 'Xác nhận' }).click();
await page.waitForTimeout(40);
check('Content hard-delete bị khoá trong dialog', contentWritePending && await contentDeleteDialog.getByRole('button', { name: 'Đang xác minh…' }).isDisabled());
await page.getByText('Không có từ nào khớp bộ lọc.', { exact: true }).waitFor();
check('Content DELETE đúng id và canonical absence', requests.some((item) => item.method === 'DELETE' && item.path === `/admin/vocabulary/${vocabCardId}`) && vocabRows.length === 0 && contentReads >= 3);

vocabRows = [
  { id: bulkVocabCardId, slug: 'recover', headword: 'recover', category: 'work-careers', level: 'B1', part_of_speech: 'verb', pronunciation: null, gloss_vi: 'phục hồi', audio_headword: null, audio_example: null, audio_status: 'pending', updated_at: null },
  { id: staleVocabCardId, slug: 'stale', headword: 'stale', category: 'work-careers', level: 'B1', part_of_speech: 'adjective', pronunciation: null, gloss_vi: 'cũ', audio_headword: null, audio_example: null, audio_status: 'pending', updated_at: null },
];
await page.getByRole('button', { name: 'Tìm', exact: true }).click();
await page.getByText('recover', { exact: true }).first().waitFor();
await page.getByText('stale', { exact: true }).first().waitFor();
await page.getByLabel('Chọn trang này').check();
partialNextContentBulk = true;
await page.getByRole('button', { name: 'Xoá (2)' }).click();
await page.getByRole('dialog', { name: 'Xoá 2 từ đã chọn?' }).getByRole('button', { name: 'Xác nhận' }).click();
await page.getByText(/Đã xoá 1 từ.*1 card đã được thay đổi hoặc xoá trước thao tác này/).waitFor();
check('Content partial bulk-delete luôn canonical readback và cảnh báo', vocabRows.length === 0 && await page.getByText('Không có từ nào khớp bộ lọc.', { exact: true }).count() === 1);

await page.locator('details.avv-content-import').evaluate((node) => { node.open = true; });
await page.locator('.avv-content-import input[type=file]').setInputFiles({ name: 'adapt.md', mimeType: 'text/markdown', buffer: Buffer.from('---\nheadword: adapt\ncategory: work-careers\n---\n') });
await page.getByText(/adapt<script>/).first().waitFor();
check('Content dry-run là multipart không commit', requests.some((item) => item.method === 'POST' && item.path === '/admin/vocabulary/import' && item.search === '?dry_run=true') && await page.getByText('1', { exact: true }).count() >= 1);
await page.getByRole('button', { name: 'Lưu vào thư viện' }).click();
await page.waitForTimeout(40);
check('Content import commit một lần và khoá resubmit', contentImportPending && await page.getByRole('button', { name: 'Đang xác minh…' }).isDisabled());
await page.getByText(/Đã lưu 1 từ mới và cập nhật 0 từ/).waitFor();
await page.getByText('adapt<script>', { exact: true }).first().waitFor();
check('Content import một combined commit và canonical list readback', requests.filter((item) => item.method === 'POST' && item.path === '/admin/vocabulary/import' && item.search === '?dry_run=false').length === 1 && vocabRows[0]?.id === importedVocabCardId && contentReads >= 4);
check('Content mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}/admin/vocab`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Vocabulary workspace', exact: true }).waitFor();
check('desktop hub dùng hai cột', await page.evaluate(() => getComputedStyle(document.querySelector('.avv-grid')).gridTemplateColumns.split(' ').length === 2));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Vocabulary native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
