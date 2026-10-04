import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuizPlayer } from '@/app/(authed-quiz-player)/quiz/quiz-player';
import { createEngine } from '@/public/js/quiz-engine.js';
import actualBanks from '../fixtures/grammar-exact-form-banks.json';
import wire from '../fixtures/grammar-native-public-wire.json';

const scope = vi.hoisted(() => ({ params: new URLSearchParams(), user: { id: 'learner-a' }, status: 'signed-in' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => scope.params }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: scope.status, user: scope.user }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
const bankA = '11111111-1111-4111-8111-111111111111';
const bankB = '22222222-2222-4222-8222-222222222222';
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
// Actual parser questions/META and actual engine; IDs are isolated transport fixtures.
function bank(id: string) {
  const parsed = actualBanks.banks.find((b) => b.code === 'G-tenses-past-perfect')!;
  return { bank: { id, title: id === bankA ? 'Past Perfect A' : 'Past Perfect B', skill_area: 'grammar', meta: parsed.meta, grammar_revision: 'a'.repeat(64), grammar_canonical_code: parsed.code, grammar_is_current: true }, questions: parsed.questions, word_cards: {}, grammar: { canonical_code: parsed.code, bank_id: id, bank_revision: 'a'.repeat(64), content_state: 'current', new_starts_enabled: true, can_continue_legacy: false, can_continue_current: false, mastery_retained: false, current_bank_id: id, current_bank_revision: 'a'.repeat(64), text_match_policy: 'qid-exact-v1' } };
}
function firstPrompt(id: string) { return createEngine(bank(bankA), { resume: [], seed: id }).next().question.prompt; }
let starts: ReturnType<typeof deferred<Record<string, unknown>>>[];
let tokenCalls: ReturnType<typeof deferred<Record<string, unknown>>>[];
let holdToken: boolean;
beforeEach(() => {
  scope.params = new URLSearchParams(`bank=${bankA}`); scope.user = { id: 'learner-a' }; scope.status = 'signed-in';
  starts = []; tokenCalls = []; holdToken = false;
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  Object.assign(window, {
    getSupabase: () => ({ auth: { getSession: () => { if (!holdToken) return Promise.resolve({ data: { session: { access_token: 'synthetic-token', user: { id: scope.user.id } } } }); const d = deferred<Record<string, unknown>>(); tokenCalls.push(d); return d.promise; } } }),
    api: { base: 'https://synthetic.invalid', getWith: vi.fn(async (url: string) => url.endsWith('/resume') ? [] : bank(url.includes(bankB) ? bankB : bankA)),
      post: vi.fn((url: string) => { if (url === '/api/quiz/sessions') { const d = deferred<Record<string, unknown>>(); starts.push(d); return d.promise; } return Promise.resolve({ ok: true }); }),
      patch: vi.fn(async () => ({})),
      postWith: (...args: unknown[]) => (window.api.post as any)(...args), patchWith: (...args: unknown[]) => (window.api.patch as any)(...args),
    },
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function move(view: ReturnType<typeof render>, id: string) { scope.params = new URLSearchParams(`bank=${id}`); view.rerender(<QuizPlayer />); }
async function release(index: number, id: string) { await act(async () => { starts[index].resolve({ session_id: id, resume: [], grammar: bank(scope.params.get('bank')!).grammar }); }); }

it('a late start ACK from A cannot replace the newer A engine after A→B→A', async () => {
  const oldId = '33333333-3333-4333-8333-333333333333'; let digit = 4;
  let currentId = `${digit}`.repeat(8) + '-4444-4444-8444-444444444444';
  while (firstPrompt(oldId) === firstPrompt(currentId)) { digit++; currentId = `${digit}`.repeat(8) + '-4444-4444-8444-444444444444'; }
  const view = render(<QuizPlayer />); await waitFor(() => expect(starts).toHaveLength(1));
  move(view, bankB); await waitFor(() => expect(starts).toHaveLength(2));
  move(view, bankA); await waitFor(() => expect(starts).toHaveLength(3));
  await release(2, currentId); await screen.findByRole('heading', { name: 'Past Perfect A' });
  const currentPrompt = document.querySelector('.qz-prompt')!.textContent;
  await release(0, oldId);
  expect(document.querySelector('.qz-prompt')!.textContent).toBe(currentPrompt);
  expect(window.api.patch).not.toHaveBeenCalled();
  expect(window.api.post).toHaveBeenCalledTimes(3);
});

it('a late auth lookup cannot publish the old admitted engine after A→B→A', async () => {
  holdToken = true;
  const view = render(<QuizPlayer />); await waitFor(() => expect(starts).toHaveLength(1));
  await release(0, '55555555-5555-4555-8555-555555555555'); await waitFor(() => expect(tokenCalls).toHaveLength(1));
  move(view, bankB); await waitFor(() => expect(starts).toHaveLength(2));
  move(view, bankA); await waitFor(() => expect(starts).toHaveLength(3));
  await release(2, '66666666-6666-4666-8666-666666666666'); await waitFor(() => expect(tokenCalls).toHaveLength(2));
  await act(async () => tokenCalls[1].resolve({ data: { session: { access_token: 'new-token', user: { id: scope.user.id } } } }));
  await screen.findByRole('heading', { name: 'Past Perfect A' });
  const prompt = document.querySelector('.qz-prompt')!.textContent;
  await act(async () => tokenCalls[0].resolve({ data: { session: { access_token: 'old-token', user: { id: scope.user.id } } } }));
  expect(document.querySelector('.qz-prompt')!.textContent).toBe(prompt);
  expect(window.api.patch).not.toHaveBeenCalled();
  expect(window.api.post).toHaveBeenCalledTimes(3);
});

const actualRequests = wire.rows.flatMap((row) => row.requests.map((request) => ({ ...request, case: row.case })));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function actualFlow(name: string) {
  const rows = actualRequests.filter((r) => r.case.includes(name));
  const bankRows = rows.filter((r) => r.method === 'GET' && r.status === 200 && (r.response as any).bank);
  const bank = (name.includes('eligible_n_minus_one') ? bankRows[0] : bankRows.find((r) => (r.response as any).grammar.content_state === 'current') || bankRows[0]).response as any;
  const started = rows.find((r) => r.method === 'POST' && r.path === '/api/quiz/sessions' && r.status === 201 && (r.response as any).grammar.bank_id === bank.bank.id)!.response as any;
  return { rows, bank: clone(bank), started: clone(started) };
}
function serve(flow: ReturnType<typeof actualFlow>, options: { start?: () => Promise<unknown>; progress?: () => Promise<unknown>; end?: () => Promise<unknown>; resume?: unknown } = {}) {
  scope.params = new URLSearchParams(`bank=${flow.bank.bank.id}`);
  window.api.getWith = vi.fn(async (url) => url.endsWith('/resume') ? clone(options.resume ?? flow.started.resume) : clone(flow.bank));
  window.api.post = vi.fn(async (url) => {
    if (url === '/api/quiz/sessions') return options.start ? options.start() : clone(flow.started);
    if (url.endsWith('/progress')) return options.progress ? options.progress() : {};
    return {};
  });
  window.api.patch = vi.fn(async () => options.end ? options.end() : {});
}
const renderedText = (value: unknown) => String(value).replaceAll('**', '').replace(/_{2,}/g, '').replace(/\s+/g, ' ').trim();
async function finishActualQuestions(flow: ReturnType<typeof actualFlow>, { review = false, stopOnUnavailable = false } = {}) {
  const engine = createEngine({ meta: flow.bank.bank.meta, questions: flow.bank.questions }, { resume: review ? [] : flow.started.resume, seed: flow.started.session_id });
  for (let item = engine.next(), count = 0; item; item = engine.next()) {
    if (++count > flow.bank.questions.length * 12) throw new Error('Real full-bank mastery engine did not terminate');
    if (stopOnUnavailable && document.querySelector('.qz-error')) return;
    const q = item.question;
    expect(renderedText(document.querySelector('.qz-prompt')?.textContent)).toBe(renderedText(q.prompt));
    const value = q.input === 'text' ? q.accept[0] : q.input === 'boolean' ? Boolean(q.answer) : q.answer;
    const graded = engine.submit(value); expect(graded.correct).toBe(true);
    if (q.input === 'text') {
      const input = screen.getByRole('textbox', { name: 'Đáp án của bạn' });
      fireEvent.change(input, { target: { value } }); fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyUp(input, { key: 'Enter' });
    } else {
      const name = q.input === 'boolean' ? value ? 'Đúng' : 'Sai' : renderedText((q.options || q.segments)[value]);
      fireEvent.click(screen.getByRole('button', { name, exact: true }));
    }
    if (stopOnUnavailable && (window.api.post as any).mock.calls.some(([url]: [string]) => url.endsWith('/progress'))) {
      await screen.findByRole('heading', { name: 'Không thể mở bài' }); return;
    }
    await screen.findByText('✓ Chính xác');
    if (stopOnUnavailable && document.querySelector('.qz-error')) return;
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp →' }));
  }
}

it.each(['lost', 'missing-policy', 'wrong-bank', 'wrong-revision', 'malformed-resume'])('managed %s start stays unavailable with one POST and no progress/end/keepalive', async (kind) => {
  const flow = actualFlow('test_real_stored_map_requires_ack_in_both_arities_before_insert[G-tenses-present-simple]');
  serve(flow, { start: async () => {
    if (kind === 'lost') throw new Error('transport lost ACK');
    const value = clone(flow.started);
    if (kind === 'missing-policy') delete value.grammar.text_match_policy;
    if (kind === 'wrong-bank') value.grammar.bank_id = bankB;
    if (kind === 'wrong-revision') value.grammar.bank_revision = 'c'.repeat(64);
    if (kind === 'malformed-resume') value.resume = null;
    return value;
  } });
  render(<QuizPlayer />); await screen.findByRole('heading', { name: 'Không thể mở bài' });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mở lại bài' })));
  expect(screen.queryByRole('button', { name: 'Kiểm tra' })).toBeNull();
  fireEvent(window, new Event('pagehide'));
  expect(window.api.post).toHaveBeenCalledTimes(1); expect(window.api.patch).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

it('invalid canonical metadata is rejected before start or pure answer presentation', async () => {
  const flow = actualFlow('test_real_stored_map_requires_ack_in_both_arities_before_insert[G-tenses-present-simple]');
  flow.bank.meta = { ...flow.bank.bank.meta, text_match_by_qid: {} };
  serve(flow); render(<QuizPlayer />);
  await screen.findByRole('heading', { name: 'Không thể mở bài' });
  expect(window.api.post).not.toHaveBeenCalled(); expect(window.api.patch).not.toHaveBeenCalled();
});

it.each(['current_bank_id', 'current_bank_revision', 'canonical_code'])('legacy malformed JSON %s is unavailable before admission', async (field) => {
  const flow = actualFlow('test_eligible_n_minus_one_start_and_corrected_explicit_ack');
  if (field === 'canonical_code') { flow.bank.bank.grammar_canonical_code = 'G-unapproved-unsupported'; flow.bank.grammar.canonical_code = 'G-unapproved-unsupported'; }
  else flow.bank.grammar[field] = [flow.bank.grammar[field]];
  serve(flow); render(<QuizPlayer />);
  await screen.findByRole('heading', { name: 'Không thể mở bài' });
  expect(window.api.post).not.toHaveBeenCalled(); expect(window.api.patch).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

it('actual reset-stale response stops queued retry, unload and end after real engine answers', async () => {
  const flow = actualFlow('test_reset_marks_open_lost_ack_all_admissions_and_stale_progress_zero_writes');
  const error = flow.rows.find((r) => r.path.endsWith('/progress') && r.status === 409)!.response as any;
  serve(flow, { progress: async () => { throw Object.assign(new Error(error.detail.message), { status: 409, detail: error.detail }); } });
  render(<QuizPlayer />); await screen.findByRole('heading', { name: flow.bank.bank.title || 'Quick-Check' });
  await finishActualQuestions(flow, { stopOnUnavailable: true });
  await screen.findByRole('heading', { name: 'Không thể mở bài' });
  expect(window.api.post).toHaveBeenCalledTimes(2); expect(window.api.patch).not.toHaveBeenCalled();
  fireEvent(window, new Event('pagehide')); expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByText('🎉 Hoàn tất phiên!')).toBeNull();
});

it('a delayed finish cannot display/end new scope after A→B→A', async () => {
  const flow = actualFlow('test_reset_marks_open_lost_ack_all_admissions_and_stale_progress_zero_writes');
  const ack = flow.rows.find((r) => r.path.endsWith('/progress') && r.status === 200)!.response;
  const pending = deferred<unknown>(); serve(flow, { progress: () => pending.promise });
  const view = render(<QuizPlayer />); await screen.findByRole('heading', { name: flow.bank.bank.title || 'Quick-Check' });
  await finishActualQuestions(flow); await waitFor(() => expect(window.api.post).toHaveBeenCalledTimes(2));
  move(view, bankB); await waitFor(() => expect(screen.queryByText('Đang lưu phần tiến độ cuối và tổng kết phiên…')).toBeNull());
  scope.params = new URLSearchParams(`bank=${flow.bank.bank.id}`); view.rerender(<QuizPlayer />);
  await screen.findByRole('heading', { name: flow.bank.bank.title || 'Quick-Check' });
  await act(async () => pending.resolve(ack));
  expect(screen.queryByText('🎉 Hoàn tất phiên!')).toBeNull(); expect(window.api.patch).not.toHaveBeenCalled();
});

it('explicit legacy continuation chooses original bank and corrected link without automatic admission', async () => {
  const flow = actualFlow('test_eligible_n_minus_one_start_and_corrected_explicit_ack');
  expect(flow.bank.grammar.content_state).toBe('legacy'); serve(flow);
  render(<QuizPlayer />); await screen.findByRole('heading', { name: 'Bài Grammar trước khi sửa' });
  expect(window.api.post).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Mở bản đã sửa' }).getAttribute('href')).toBe(`/quiz?bank=${flow.bank.grammar.current_bank_id}`);
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục bản trước' }));
  await screen.findByRole('heading', { name: flow.bank.bank.title || 'Quick-Check' });
  expect(window.api.post).toHaveBeenCalledTimes(1);
  expect((window.api.post as any).mock.calls[0][1].bank_id).toBe(flow.bank.bank.id);
});

it.each(['test_absent_empty_map_preserves_four_arg_and_redundant_ack[None]', 'test_absent_empty_map_preserves_four_arg_and_redundant_ack[policy1]'])('canonical %s activation uses bank META without capability ACK', async (name) => {
  const flow = actualFlow(name); serve(flow); render(<QuizPlayer />);
  await screen.findByRole('heading', { name: flow.bank.bank.title || 'Quick-Check' });
  const body = (window.api.post as any).mock.calls[0][1]; expect(body.grammar_revision).toBe(flow.bank.grammar.bank_revision); expect(body.text_match_policy).toBeUndefined();
});

it('actual paused-current canonical proof allows existing unfinished work while new starts are disabled', async () => {
  const flow = actualFlow('test_paused_corrected_reload_derives_unmarked_run_not_newer_review[paused]');
  flow.bank = clone(flow.rows.find((row) => row.method === 'GET' && (row.response as any).bank
    && (row.response as any).grammar.new_starts_enabled === false
    && (row.response as any).grammar.can_continue_current === true)!.response as any);
  flow.started = clone(flow.rows.find((row) => row.status === 201
    && (row.response as any).grammar.new_starts_enabled === false)!.response as any);
  serve(flow); render(<QuizPlayer />); await screen.findByRole('heading', { name: flow.bank.bank.title || 'Quick-Check' });
  expect(window.api.post).toHaveBeenCalledTimes(1);
  expect((window.api.post as any).mock.calls[0][1].bank_id).toBe(flow.bank.bank.id);
  expect((window.api.post as any).mock.calls[0][1].grammar_revision).toBe(flow.bank.bank.grammar_revision);
  expect(window.api.patch).not.toHaveBeenCalled();
});

it('actual canonical disabled-current state with no continuation exposes reopen but creates no session', async () => {
  const flow = actualFlow('test_reset_marks_open_lost_ack_all_admissions_and_stale_progress_zero_writes');
  flow.bank = clone(flow.rows.findLast((row) => row.method === 'GET' && (row.response as any).bank)!.response as any);
  serve(flow, { resume: [] }); render(<QuizPlayer />);
  await screen.findByRole('heading', { name: 'Bài đang tạm dừng lượt mới' });
  expect(screen.getByRole('button', { name: 'Mở lại bài' })).toBeTruthy();
  expect(window.api.post).not.toHaveBeenCalled(); expect(window.api.patch).not.toHaveBeenCalled();
});

function masteredResume(flow: ReturnType<typeof actualFlow>) {
  const engine = createEngine({ meta: flow.bank.bank.meta, questions: flow.bank.questions });
  for (let item = engine.next(); item; item = engine.next()) {
    const q = item.question; engine.submit(q.input === 'text' ? q.accept[0] : q.input === 'boolean' ? Boolean(q.answer) : q.answer);
  }
  expect(engine.progress().remaining).toBe(0);
  return engine.drainBatch().word_stats;
}

it('explicit readonly admission uses the real engine but writes no attempts/mastery, even on terminalization', async () => {
  const flow = actualFlow('test_review_records_no_graded_progress');
  const end = flow.rows.find((r) => r.method === 'PATCH' && r.status === 200)!.response;
  serve(flow, { resume: masteredResume(flow), end: async () => clone(end) });
  render(<QuizPlayer />); await screen.findByRole('button', { name: '🔁 Ôn tập lại' });
  expect(window.api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '🔁 Ôn tập lại' }));
  await screen.findByRole('heading', { name: flow.bank.bank.title || 'Quick-Check' });
  expect((window.api.post as any).mock.calls[0][1].admission_kind).toBe('review');
  await finishActualQuestions(flow, { review: true }); await screen.findByRole('heading', { name: '🎉 Hoàn tất phiên!' });
  expect(window.api.post).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  const summary = (window.api.patch as any).mock.calls[0][1];
  expect(summary.total_questions).toBe(0); expect(summary.words_mastered).toBe(0); expect(summary.attempts).toEqual([]);
});

it('lost managed reset ACK never treats an empty resume as confirmation or starts a new session', async () => {
  const flow = actualFlow('test_reset_marks_open_lost_ack_all_admissions_and_stale_progress_zero_writes');
  serve(flow, { resume: masteredResume(flow) });
  window.api.post = vi.fn(async () => { throw new Error('lost reset ACK'); }); vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<QuizPlayer />); await screen.findByRole('button', { name: '♻️ Làm lại từ đầu' });
  const before = (window.api.getWith as any).mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '♻️ Làm lại từ đầu' }));
  await screen.findByText(/Không xác nhận được việc xoá tiến độ/);
  expect(window.api.post).toHaveBeenCalledTimes(1); expect((window.api.getWith as any).mock.calls.length).toBe(before);
  expect(window.api.patch).not.toHaveBeenCalled();
});

it('successful managed reset waits for fresh bank plus resume before sending a new start', async () => {
  const flow = actualFlow('test_reset_marks_open_lost_ack_all_admissions_and_stale_progress_zero_writes');
  const reset = flow.rows.find((r) => r.path.endsWith('/reset') && r.status === 200)!.response;
  serve(flow, { resume: masteredResume(flow) }); vi.spyOn(window, 'confirm').mockReturnValue(true);
  const refreshed = deferred<unknown>(); let bankReads = 0; let resumeReads = 0;
  window.api.getWith = vi.fn(async (url) => {
    if (url.endsWith('/resume')) return ++resumeReads === 1 ? masteredResume(flow) : [];
    if (++bankReads === 2) return refreshed.promise;
    return clone(flow.bank);
  });
  window.api.post = vi.fn(async (url) => url.endsWith('/reset') ? clone(reset) : clone(flow.started));
  render(<QuizPlayer />); await screen.findByRole('button', { name: '♻️ Làm lại từ đầu' });
  fireEvent.click(screen.getByRole('button', { name: '♻️ Làm lại từ đầu' }));
  await waitFor(() => expect(bankReads).toBe(2)); expect(window.api.post).toHaveBeenCalledTimes(1); expect(resumeReads).toBe(1);
  await act(async () => refreshed.resolve(clone(flow.bank)));
  await screen.findByRole('heading', { name: flow.bank.bank.title || 'Quick-Check' });
  expect(resumeReads).toBe(2); expect(window.api.post).toHaveBeenCalledTimes(2);
  expect((window.api.post as any).mock.calls[1][1].grammar_revision).toBe(flow.bank.grammar.bank_revision);
});

it('delayed reset ACK from A is discarded after A→B→A without old-finally unlocking or fresh admission', async () => {
  const flow = actualFlow('test_reset_marks_open_lost_ack_all_admissions_and_stale_progress_zero_writes');
  const reset = flow.rows.find((r) => r.path.endsWith('/reset') && r.status === 200)!.response;
  const held = deferred<unknown>(); serve(flow, { resume: masteredResume(flow) });
  window.api.post = vi.fn(() => held.promise); vi.spyOn(window, 'confirm').mockReturnValue(true);
  const view = render(<QuizPlayer />); await screen.findByRole('button', { name: '♻️ Làm lại từ đầu' });
  fireEvent.click(screen.getByRole('button', { name: '♻️ Làm lại từ đầu' })); await waitFor(() => expect(window.api.post).toHaveBeenCalledTimes(1));
  move(view, bankB); await screen.findByRole('heading', { name: 'Không thể mở bài' });
  scope.params = new URLSearchParams(`bank=${flow.bank.bank.id}`); view.rerender(<QuizPlayer />);
  await screen.findByRole('button', { name: '♻️ Làm lại từ đầu' });
  const reads = (window.api.getWith as any).mock.calls.length;
  await act(async () => held.resolve(reset));
  expect((window.api.getWith as any).mock.calls.length).toBe(reads); expect(window.api.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '♻️ Làm lại từ đầu' }).hasAttribute('disabled')).toBe(false);
});

it('a held end ACK cannot publish summary after A→B→A', async () => {
  const flow = actualFlow('test_actual_pg_end_rows_through_real_asgi_facade_keep_frozen_identity_and_explicit_null[False]');
  const end = flow.rows.find((r) => r.method === 'PATCH' && r.status === 200)!.response;
  const held = deferred<unknown>(); serve(flow, { progress: async () => ({ ok: false }), end: () => held.promise });
  const view = render(<QuizPlayer />); await screen.findByRole('heading', { name: flow.bank.bank.title || 'Quick-Check' });
  await finishActualQuestions(flow); await waitFor(() => expect(window.api.patch).toHaveBeenCalledTimes(1));
  move(view, bankB); await screen.findByRole('heading', { name: 'Không thể mở bài' });
  scope.params = new URLSearchParams(`bank=${flow.bank.bank.id}`); view.rerender(<QuizPlayer />);
  await screen.findByRole('heading', { name: flow.bank.bank.title || 'Quick-Check' });
  await act(async () => held.resolve(end));
  expect(screen.queryByText('🎉 Hoàn tất phiên!')).toBeNull(); expect(window.api.patch).toHaveBeenCalledTimes(1);
});

it('unmount disposes a held start without activation, progress, end or unload writes', async () => {
  const view = render(<QuizPlayer />); await waitFor(() => expect(starts).toHaveLength(1));
  view.unmount(); await release(0, '77777777-7777-4777-8777-777777777777');
  expect(window.api.post).toHaveBeenCalledTimes(1); expect(window.api.patch).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

it('same query account A→B→A cannot adopt an old start response', async () => {
  const view = render(<QuizPlayer />); await waitFor(() => expect(starts).toHaveLength(1));
  scope.user = { id: 'learner-b' }; view.rerender(<QuizPlayer />); await waitFor(() => expect(starts).toHaveLength(2));
  scope.user = { id: 'learner-a' }; view.rerender(<QuizPlayer />); await waitFor(() => expect(starts).toHaveLength(3));
  await release(2, '88888888-8888-4888-8888-888888888888'); await screen.findByRole('heading', { name: 'Past Perfect A' });
  const prompt = document.querySelector('.qz-prompt')!.textContent;
  await release(0, '33333333-3333-4333-8333-333333333333');
  expect(document.querySelector('.qz-prompt')!.textContent).toBe(prompt); expect(window.api.post).toHaveBeenCalledTimes(3); expect(window.api.patch).not.toHaveBeenCalled();
});
it.each(['query', 'account'])('an old401 after %s A→B→A cannot redirect or replace the latest admitted scope', async (kind) => {
  const view = render(<QuizPlayer />); await waitFor(() => expect(starts).toHaveLength(1));
  if (kind === 'query') move(view, bankB); else { scope.user = { id: 'learner-b' }; view.rerender(<QuizPlayer />); }
  await waitFor(() => expect(starts).toHaveLength(2));
  if (kind === 'query') move(view, bankA); else { scope.user = { id: 'learner-a' }; view.rerender(<QuizPlayer />); }
  await waitFor(() => expect(starts).toHaveLength(3));
  await release(2, '88888888-8888-4888-8888-888888888888'); await screen.findByRole('heading', { name: 'Past Perfect A' });
  const prompt = document.querySelector('.qz-prompt')!.textContent, url = window.location.href;
  await act(async () => starts[0].reject(Object.assign(new Error('old unauthorized'), { status: 401 })));
  expect(window.location.href).toBe(url); expect(document.querySelector('.qz-prompt')!.textContent).toBe(prompt);
  expect(screen.queryByRole('heading', { name: 'Không thể mở bài' })).toBeNull(); expect(window.api.patch).not.toHaveBeenCalled();
});
it('active403 remains a visible ordinary failure without progress/end or global login redirect', async () => {
  const url = window.location.href;
  render(<QuizPlayer />); await waitFor(() => expect(starts).toHaveLength(1));
  await act(async () => starts[0].reject(Object.assign(new Error('forbidden'), { status: 403 })));
  await screen.findByRole('heading', { name: 'Không thể mở bài' });
  expect(window.location.href).toBe(url); expect(window.api.post).toHaveBeenCalledTimes(1); expect(window.api.patch).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it('auth session missing or belonging to another account cannot activate an admitted managed bank', async () => {
  Object.assign(window, { getSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'other-user-token', user: { id: 'learner-b' } } } }) } }) });
  render(<QuizPlayer />); await waitFor(() => expect(starts).toHaveLength(1)); await release(0, '33333333-3333-4333-8333-333333333333');
  await screen.findByRole('heading', { name: 'Không thể mở bài' }); expect(window.api.post).toHaveBeenCalledTimes(1); expect(window.api.patch).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it('StrictMode setup/cleanup creates only one admitted action and keeps its real engine ready', async () => {
  render(<StrictMode><QuizPlayer /></StrictMode>); await waitFor(() => expect(starts).toHaveLength(1));
  await release(0, '33333333-3333-4333-8333-333333333333');
  await screen.findByRole('heading', { name: 'Past Perfect A' }); expect(window.api.post).toHaveBeenCalledTimes(1); expect(window.api.patch).not.toHaveBeenCalled();
});

it('a card opened in A cannot reappear or steal focus when B contains the same item key', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  window.api.getWith = vi.fn(async (url: string) => {
    if (url.endsWith('/resume')) return [];
    const value = bank(url.includes(bankB) ? bankB : bankA);
    return { ...value, word_cards: Object.fromEntries(value.questions.map((q) =>
      [q.item_key.toLowerCase(), { headword: url.includes(bankB) ? 'Card B' : 'Card A', audio_headword: 'https://synthetic.invalid/audio' }])) };
  });
  const view = render(<QuizPlayer />); await waitFor(() => expect(starts).toHaveLength(1));
  await release(0, '33333333-3333-4333-8333-333333333333');
  await screen.findByRole('heading', { name: 'Past Perfect A' });
  const input = screen.queryByRole('textbox');
  if (input) { fireEvent.change(input, { target: { value: 'probe' } }); fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' })); }
  else fireEvent.click(document.querySelector('.qz-opt')!);
  const opener = await screen.findByRole('button', { name: '📇 Xem nhanh thẻ từ' });
  fireEvent.click(opener);
  await screen.findByRole('dialog', { name: 'Card A' });
  fireEvent.click(screen.getByRole('button', { name: '🔊 Nghe phát âm' }));
  const pauses = vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length;
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(opener);
  fireEvent.click(opener); await screen.findByRole('dialog', { name: 'Card A' });
  move(view, bankB); await waitFor(() => expect(starts).toHaveLength(2));
  await release(1, '44444444-4444-4444-8444-444444444444');
  await screen.findByRole('heading', { name: 'Past Perfect B' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement?.closest('.qz-dialog')).toBeNull();
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length).toBeGreaterThan(pauses);
});

// These labels derive only from the already-validated managed bank state.
it('validated current work has an ordinary correction label; legacy work keeps its separate continuation language', async () => {
  const current = actualFlow('test_actual_twelve_sources_policy_copy_readback_and_synthetic_original_history[G-tenses-past-perfect]');
  serve(current); const view = render(<QuizPlayer />);
  await screen.findByRole('heading', { name: current.bank.bank.title });
  expect(screen.getByText('Bản đã sửa')).toBeTruthy();
  expect(window.api.post).toHaveBeenCalledTimes(1);
  const legacy = actualFlow('test_eligible_n_minus_one_start_and_corrected_explicit_ack');
  serve(legacy); view.rerender(<QuizPlayer />);
  await screen.findByRole('heading', { name: 'Bài Grammar trước khi sửa' });
  expect(screen.queryByText('Bản đã sửa')).toBeNull();
  expect(screen.getByRole('link', { name: 'Mở bản đã sửa' }).getAttribute('href')).toBe(`/quiz?bank=${legacy.bank.grammar.current_bank_id}`);
  expect(window.api.post).not.toHaveBeenCalled();
});
it('unmanaged bank code/title cannot imply a corrected-version label', async () => {
  const current = actualFlow('test_actual_twelve_sources_policy_copy_readback_and_synthetic_original_history[G-tenses-past-perfect]');
  delete current.bank.grammar;
  for (const key of ['grammar_revision', 'grammar_canonical_code', 'grammar_is_current']) delete current.bank.bank[key];
  delete current.bank.bank.meta.text_match_by_qid;
  serve(current);
  render(<QuizPlayer />); await screen.findByRole('heading', { name: current.bank.bank.title });
  expect(screen.queryByText('Bản đã sửa')).toBeNull();
  expect(window.api.post).toHaveBeenCalledTimes(1);
});
