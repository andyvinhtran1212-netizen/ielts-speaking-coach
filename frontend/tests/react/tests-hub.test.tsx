// LEARNERCORE-0063 T16 part 2b (amendment 1, FR-080…FR-084): the Thi thử hub
// (`tests-hub-v2.tsx`, the flag-on branch of the /tests page of LEARNERNAV-0062
// T12a) over `GET /api/student/tests` (#2603). Cases from plan.md "(Bản sửa
// đổi 1) T16" and ui-states.md "Thi thử /tests":
// - block 2 only when an exam is assigned; self_paced without Speaking says
//   "Gồm: …" and the back-to-back sentence, and has no Overall;
// - never "4 kỹ năng" / "bốn kỹ năng" for a self-chosen test, in any state;
// - 390px: full-test entries become the PHONEGATE-0081 warning, mini tests keep
//   their link;
// - credits.total 1: Writing full "Không đủ lượt" + "Xem cách thêm lượt",
//   Listening full keeps its link; credits null marks nothing;
// - a target that is not live hides its row;
// - results: band only from the API, "Đúng a trên b câu", "Đang chấm",
//   unreleased mock "Đang chờ công bố" with no score, Overall rules, 20 per
//   page with "Xem thêm", empty "Bạn chưa nộp bài thi nào.";
// - degraded parts report in their own block; one account's answer is never
//   drawn for another.
//
// Written ahead of the component (G08 thread, 23/11): the import path below is
// the route group T12a is expected to create; change only that line if T12a
// names it differently. The PHONEGATE-0081 copy is not approved yet, so the
// 390px case checks for the G03 warning ("Cảnh báo") instead of its words.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { TestsHubV2 } from '@/app/(authed-v2-tests)/tests/tests-hub-v2';

const notLive = vi.hoisted(() => new Set<string>());
vi.mock('@/components/ui/shell/learner-sections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/shell/learner-sections')>();
  return {
    ...actual,
    isLiveRoute: (href: string) => !notLive.has(href),
    liveHref: ({ href, today }: { href: string; today: string | null }) => {
      if (!notLive.has(href)) return href;
      return today && !notLive.has(today) ? today : null;
    },
  };
});

const FOUR = ['listening', 'reading', 'writing', 'speaking'];

function payload(over: Record<string, unknown> = {}) {
  return { assigned_exams: [], results: [], results_next_cursor: null, credits: { total: 7 }, degraded: [], ...over };
}

function exam(over: Record<string, unknown> = {}) {
  return {
    exam_id: 'e1', title: 'Mock tháng 11', mode: 'live', state: 'open',
    opens_at: '2026-11-25T13:00:00Z', closes_at: '2026-11-25T16:00:00Z',
    skills: FOUR, total_minutes: 165, has_sitting_in_progress: false, href: '/mock-exam?code=NOV', ...over,
  };
}

function result(over: Record<string, unknown> = {}) {
  return {
    kind: 'listening_full', id: 'a1', title: 'Cam 18 Test 1', submitted_at: '2026-11-22T17:30:00Z',
    state: null, band: 7, correct: null, total: null, pending_skills: null, overall: null,
    href: '/listening/result?attempt_id=a1', ...over,
  };
}

let getWith: ReturnType<typeof vi.fn>;
let viewport = 1280;

function install(fn: (path: string, ...rest: unknown[]) => unknown) {
  getWith = vi.fn(fn);
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post: vi.fn() } });
}

function setViewport(width: number) {
  viewport = width;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  notLive.clear();
  setViewport(1280);
  // A viewport-aware matchMedia: `(min-width: Npx)` / `(max-width: Npx)` against `viewport`.
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(query);
    const matches = (min ? viewport >= Number(min[1]) : true) && (max ? viewport <= Number(max[1]) : true);
    return {
      matches, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function renderHub(data: unknown, accountId = 'learner-1') {
  install(async () => data);
  const view = render(<TestsHubV2 accountId={accountId} />);
  await waitFor(() => expect(getWith).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('main').getAttribute('aria-busy')).toBeNull());
  return view;
}

function selfRow(title: string) {
  const block = screen.getByRole('region', { name: 'Đề tự chọn' });
  return within(block).queryAllByRole('listitem').find((li) => li.textContent?.includes(title)) || null;
}

// ── data source ──────────────────────────────────────────────────────

it('reads GET /api/student/tests once, through the shared transport', async () => {
  await renderHub(payload());
  expect(getWith).toHaveBeenCalledTimes(1);
  expect(String(getWith.mock.calls[0][0])).toBe('/api/student/tests');
});

// ── block 1: self-chosen tests (FR-080, FR-083, FR-084) ──────────────

it('block 1: a full and a mini row per skill, to the existing pickers; never a four-skill self-chosen test', async () => {
  await renderHub(payload());
  const block = screen.getByRole('region', { name: 'Đề tự chọn' });
  for (const [title, href] of [
    ['Full test Listening', '/listening/tests'], ['Mini test Listening', '/listening/mini-test'],
    ['Full test Reading', '/reading/test'], ['Mini test Reading', '/reading/mini-test'],
  ]) {
    const row = selfRow(title);
    expect(row, title).toBeTruthy();
    expect(within(row!).getByRole('link').getAttribute('href')).toBe(href);
  }
  expect(selfRow('Full test Speaking')).toBeTruthy();
  // No limit on attempts written on the page.
  expect(block.textContent).not.toMatch(/lần còn lại|tối đa \d+ lần/i);
});

it('no "4 kỹ năng" / "bốn kỹ năng" self-chosen test in any combination of data', async () => {
  for (const data of [
    payload(),
    payload({ credits: null, degraded: ['assigned_exams', 'results'] }),
    payload({ assigned_exams: [exam(), exam({ exam_id: 'e2', mode: 'self_paced', skills: ['listening', 'reading'] })], results: [result()] }),
  ]) {
    const view = await renderHub(data);
    expect(document.body.textContent).not.toMatch(/4 kỹ năng|bốn kỹ năng/i);
    view.unmount();
  }
});

it('a target that is not live hides its row, never a link to a 404', async () => {
  notLive.add('/reading/mini-test');
  await renderHub(payload());
  expect(selfRow('Mini test Reading')).toBeNull();
  expect(selfRow('Full test Reading')).toBeTruthy();
  expect(document.querySelector('a[href="/reading/mini-test"]')).toBeNull();
});

it('390px: full-test entries become the phone-gate warning; mini tests keep their link (PHONEGATE-0081 FR-050, FR-053)', async () => {
  setViewport(390);
  await renderHub(payload({ assigned_exams: [exam()] }));
  for (const title of ['Full test Listening', 'Full test Reading']) {
    const row = selfRow(title)!;
    expect(within(row).queryByRole('link')).toBeNull();
    expect(row.textContent).toMatch(/Cảnh báo/);
  }
  for (const title of ['Mini test Listening', 'Mini test Reading']) {
    expect(within(selfRow(title)!).getByRole('link')).toBeTruthy();
  }
  // Block 2 "Vào thi" is a full-test entry too.
  const assigned = screen.getByRole('region', { name: 'Mock test được giao' });
  expect(within(assigned).queryByRole('link', { name: 'Vào thi' })).toBeNull();
  expect(assigned.textContent).toMatch(/Cảnh báo/);
});

it('credits.total 1: Writing full says "Không đủ lượt" with "Xem cách thêm lượt"; Listening full keeps its link', async () => {
  await renderHub(payload({ credits: { total: 1 } }));
  const writing = selfRow('Full test Writing')!;
  expect(writing.textContent).toMatch(/Không đủ lượt/);
  expect(within(writing).queryByRole('link', { name: /Full test Writing/ })).toBeNull();
  const how = within(writing).getByRole('button', { name: 'Xem cách thêm lượt' });
  fireEvent.click(how);
  // The G03 Notice with the CreditsEmptyNotice words (T14) opens; nothing is bought from here.
  await waitFor(() => expect(screen.getByText(/Bạn đã dùng hết lượt chấm AI/)).toBeTruthy());
  const speaking = selfRow('Full test Speaking')!;
  expect(speaking.textContent).toMatch(/Không đủ lượt/);
  const listening = selfRow('Full test Listening')!;
  expect(listening.textContent).not.toMatch(/Không đủ lượt/);
  expect(within(listening).getByRole('link')).toBeTruthy();
});

it('credits null (no G04 data, an error, an old class code): no row is marked', async () => {
  await renderHub(payload({ credits: null }));
  expect(document.body.textContent).not.toMatch(/Không đủ lượt/);
  expect(screen.queryByRole('button', { name: 'Xem cách thêm lượt' })).toBeNull();
});

it('credits degraded: no row is marked either', async () => {
  await renderHub(payload({ credits: null, degraded: ['credits'] }));
  expect(document.body.textContent).not.toMatch(/Không đủ lượt/);
});

// ── block 2: assigned mock tests (FR-081) ────────────────────────────

it('no exam assigned: no block 2 and no empty sentence inviting to sit one', async () => {
  await renderHub(payload());
  expect(screen.queryByRole('region', { name: 'Mock test được giao' })).toBeNull();
  expect(document.body.textContent).not.toMatch(/Mock test được giao/);
});

it('self_paced without Speaking: "Gồm: …", the back-to-back sentence with N from the API, mode line, no Overall', async () => {
  await renderHub(payload({
    assigned_exams: [exam({ mode: 'self_paced', skills: ['listening', 'reading', 'writing'], total_minutes: 160, opens_at: null, closes_at: '2026-11-30T16:59:00Z' })],
  }));
  const block = screen.getByRole('region', { name: 'Mock test được giao' });
  expect(within(block).getByText('Mock tháng 11')).toBeTruthy();
  expect(block.textContent).toMatch(/Bắt đầu lúc nào cũng được trong thời gian mở/);
  expect(block.textContent).toMatch(/Gồm: Listening, Reading, Writing/);
  expect(block.textContent).toMatch(/Làm liền một mạch khoảng 160 phút\. Đã bắt đầu thì không dừng giữa các phần\./);
  expect(block.textContent).toMatch(/23:59 30\/11\/2026/);      // Vietnam time
  expect(block.textContent).not.toMatch(/Overall/);
});

it('self_paced without total_minutes: no sentence, never a sum made on the page', async () => {
  await renderHub(payload({ assigned_exams: [exam({ mode: 'self_paced', total_minutes: null })] }));
  expect(screen.getByRole('region', { name: 'Mock test được giao' }).textContent).not.toMatch(/Làm liền một mạch/);
});

it('live exam: "Thi cùng giờ", window in Vietnam time, "Vào thi" to the API href; with a sitting in progress "Làm tiếp"', async () => {
  await renderHub(payload({
    assigned_exams: [exam(), exam({ exam_id: 'e2', title: 'Mock lớp 9', has_sitting_in_progress: true, href: '/mock-exam?sitting=s9' })],
  }));
  const block = screen.getByRole('region', { name: 'Mock test được giao' });
  expect(block.textContent).toMatch(/Thi cùng giờ/);
  expect(block.textContent).toMatch(/20:00 25\/11\/2026/);
  expect(block.textContent).toMatch(/23:00 25\/11\/2026/);
  expect(block.textContent).not.toMatch(/Gồm:/);                // all four skills
  expect(within(block).getByRole('link', { name: 'Vào thi' }).getAttribute('href')).toBe('/mock-exam?code=NOV');
  expect(within(block).getByRole('link', { name: 'Làm tiếp' }).getAttribute('href')).toBe('/mock-exam?sitting=s9');
});

it('each state in words, exactly one; a button only for "Đang mở" and "Đã có kết quả"', async () => {
  const states = [
    ['upcoming', 'Sắp diễn ra'], ['open', 'Đang mở'], ['submitted', 'Đã thi, chờ kết quả'],
    ['released', 'Đã có kết quả'], ['closed_missed', 'Đã đóng, bạn chưa thi'],
  ];
  await renderHub(payload({
    assigned_exams: states.map(([state], i) => exam({
      exam_id: `e${i}`, title: `Kỳ ${i}`, state, mode: null, href: state === 'released' ? `/mock/result?sitting=s${i}` : `/mock-exam?code=K${i}`,
    })),
  }));
  const block = screen.getByRole('region', { name: 'Mock test được giao' });
  const rows = within(block).getAllByRole('listitem');
  expect(rows).toHaveLength(5);
  rows.forEach((row, i) => {
    const labels = states.map(([, label]) => label).filter((label) => row.textContent?.includes(label));
    expect(labels, `row ${i}`).toEqual([states[i][1]]);
  });
  expect(within(rows[1]).getByRole('link', { name: 'Vào thi' })).toBeTruthy();
  expect(within(rows[3]).getByRole('link', { name: 'Xem kết quả' }).getAttribute('href')).toBe('/mock/result?sitting=s3');
  for (const i of [0, 2, 4]) expect(within(rows[i]).queryByRole('link')).toBeNull();
  // mode null → no mode line.
  expect(block.textContent).not.toMatch(/Thi cùng giờ|Bắt đầu lúc nào cũng được/);
  // No internal code in the row.
  expect(block.textContent).not.toMatch(/\bK\d\b|NOV/);
});

it('assigned_exams degraded: block 2 reports the failure instead of disappearing', async () => {
  await renderHub(payload({ degraded: ['assigned_exams'] }));
  const block = screen.getByRole('region', { name: 'Mock test được giao' });
  expect(within(block).getByText(/Cảnh báo|Lỗi/)).toBeTruthy();
});

// ── block 3: results (FR-082) ────────────────────────────────────────

it('no result yet: "Bạn chưa nộp bài thi nào."', async () => {
  await renderHub(payload());
  expect(within(screen.getByRole('region', { name: 'Kết quả' })).getByText('Bạn chưa nộp bài thi nào.')).toBeTruthy();
});

it('each row: title, kind, Vietnam submit date and the FR-077 result; the row opens the result page', async () => {
  await renderHub(payload({
    results: [
      result({ id: '1' }),
      result({ id: '2', kind: 'listening_full', band: null, title: 'Đề 38 câu' }),
      result({ id: '3', kind: 'reading_mini', band: null, correct: 12, total: 20, title: 'Mini 3', href: '/reading/result?attempt_id=3' }),
      result({ id: '4', kind: 'reading_mini', band: null, correct: 0, total: 0, title: 'Mini rỗng' }),
      result({ id: '5', kind: 'writing_full', band: null, title: 'Writing đề 5', href: '/writing/result?essay_id=5' }),
      result({ id: '6', kind: 'speaking_full', band: 6.5, title: 'Speaking chuỗi 6', href: '/full-test-result?session_id=6' }),
    ],
  }));
  const block = screen.getByRole('region', { name: 'Kết quả' });
  const rows = within(block).getAllByRole('listitem');
  expect(rows).toHaveLength(6);
  expect(rows[0].textContent).toMatch(/Cam 18 Test 1/);
  expect(rows[0].textContent).toMatch(/Full test Listening/);
  expect(rows[0].textContent).toMatch(/23\/11\/2026/);             // 17:30Z is the next day in Vietnam
  expect(rows[0].textContent).toMatch(/7\.0/);
  expect(rows[1].textContent).not.toMatch(/Band|\d\.\d/);         // 38 questions: no band
  expect(rows[2].textContent).toMatch(/Mini test Reading/);
  expect(rows[2].textContent).toMatch(/Đúng 12 trên 20 câu/);
  expect(rows[3].textContent).not.toMatch(/trên 0/);
  expect(rows[4].textContent).toMatch(/Đang chấm/);
  expect(rows[5].textContent).toMatch(/6\.5/);
  expect(within(rows[2]).getByRole('link').getAttribute('href')).toBe('/reading/result?attempt_id=3');
  expect(within(rows[5]).getByRole('link').getAttribute('href')).toBe('/full-test-result?session_id=6');
});

it('an unreleased mock shows only "Đang chờ công bố": no band, no Overall, even if a score leaked into the payload', async () => {
  await renderHub(payload({
    results: ['submitted', 'grading', 'reviewing'].map((state, i) => result({
      id: `m${i}`, kind: 'mock', state, title: `Mock ${i}`, band: 8, overall: 7.5, pending_skills: ['speaking'], href: `/mock/result?sitting=s${i}`,
    })),
  }));
  const rows = within(screen.getByRole('region', { name: 'Kết quả' })).getAllByRole('listitem');
  for (const row of rows) {
    expect(row.textContent).toMatch(/Mock test/);
    expect(row.textContent).toMatch(/Đang chờ công bố/);
    expect(row.textContent).not.toMatch(/7\.5|8\.0|Chưa có Overall/);
  }
});

it('Overall only on a released mock with four bands; four skills still grading: "Chưa có Overall: còn chờ chấm Speaking"', async () => {
  await renderHub(payload({
    results: [
      result({ id: 'r1', kind: 'mock', state: 'released', title: 'Mock đủ', overall: 6.5, href: '/mock/result?sitting=r1' }),
      result({ id: 'r2', kind: 'mock', state: 'released', title: 'Mock chờ', overall: null, pending_skills: ['speaking'], href: '/mock/result?sitting=r2' }),
      result({ id: 'r3', kind: 'mock', state: 'released', title: 'Mock ba kỹ năng', overall: null, href: '/mock/result?sitting=r3' }),
      result({ id: 'r4' }),
    ],
  }));
  const rows = within(screen.getByRole('region', { name: 'Kết quả' })).getAllByRole('listitem');
  expect(rows[0].textContent).toMatch(/6\.5/);
  expect(rows[1].textContent).toMatch(/Chưa có Overall: còn chờ chấm Speaking/);
  // Empty Overall cell: a screen-reader label, never a lone "—".
  for (const row of [rows[2], rows[3]]) {
    expect(within(row).getByLabelText('Không có Overall')).toBeTruthy();
    expect(row.textContent).not.toMatch(/(^|\s)—(\s|$)/);
  }
});

it('20 rows, then "Xem thêm" reads the next page by its cursor and appends; no button without a cursor', async () => {
  const first = Array.from({ length: 20 }, (_, i) => result({ id: `p1-${i}`, title: `Đề ${i + 1}` }));
  const second = [result({ id: 'p2-0', title: 'Đề 21' })];
  install(async (path: string) => (String(path).includes('cursor=')
    ? payload({ results: second, results_next_cursor: null })
    : payload({ results: first, results_next_cursor: 'CUR1' })));
  render(<TestsHubV2 accountId="learner-1" />);
  const block = await screen.findByRole('region', { name: 'Kết quả' });
  await waitFor(() => expect(within(block).getAllByRole('listitem')).toHaveLength(20));
  fireEvent.click(within(block).getByRole('button', { name: 'Xem thêm' }));
  await waitFor(() => expect(within(block).getAllByRole('listitem')).toHaveLength(21));
  expect(getWith.mock.calls.some(([path]) => String(path).startsWith('/api/student/tests') && String(path).includes('cursor=CUR1'))).toBe(true);
  expect(within(block).queryByRole('button', { name: 'Xem thêm' })).toBeNull();
  // The next page never re-renders block 2 empty (it carries no assigned part).
  expect(within(block).getByText('Đề 21')).toBeTruthy();
});

it('results degraded: block 3 reports it with "Thử lại", which reads again', async () => {
  let calls = 0;
  install(async () => {
    calls += 1;
    return calls === 1 ? payload({ degraded: ['results'] }) : payload({ results: [result()] });
  });
  render(<TestsHubV2 accountId="learner-1" />);
  const block = await screen.findByRole('region', { name: 'Kết quả' });
  const retry = await within(block).findByRole('button', { name: 'Thử lại' });
  expect(within(block).queryByText('Bạn chưa nộp bài thi nào.')).toBeNull();
  fireEvent.click(retry);
  await waitFor(() => expect(within(block).getByText('Cam 18 Test 1')).toBeTruthy());
  // Block 1 never disappears while blocks 2/3 load or fail.
  expect(screen.getByRole('region', { name: 'Đề tự chọn' })).toBeTruthy();
});

it('a failed read: blocks 2/3 report it, block 1 stays', async () => {
  install(async () => { throw Object.assign(new Error('HTTP 500'), { status: 500 }); });
  render(<TestsHubV2 accountId="learner-1" />);
  const results = await screen.findByRole('region', { name: 'Kết quả' });
  await within(results).findByRole('button', { name: 'Thử lại' });
  expect(screen.getByRole('region', { name: 'Đề tự chọn' })).toBeTruthy();
});

// ── account ownership (same rule as Today, HOLD 10:28Z on #2543) ─────

it('an answer for one account is never drawn for another', async () => {
  let release: ((value: unknown) => void) | null = null;
  install((path: string) => new Promise((resolve) => {
    if (!release) { release = resolve; return; }
    resolve(payload({ results: [result({ id: 'b1', title: 'Bài của B' })] }));
  }));
  const view = render(<TestsHubV2 accountId="learner-A" />);
  await waitFor(() => expect(getWith).toHaveBeenCalledTimes(1));
  view.rerender(<TestsHubV2 accountId="learner-B" />);
  await waitFor(() => expect(getWith).toHaveBeenCalledTimes(2));
  await act(async () => { release!(payload({ results: [result({ id: 'a1', title: 'Bài của A' })] })); });
  await screen.findByText('Bài của B');
  expect(screen.queryByText('Bài của A')).toBeNull();
});
