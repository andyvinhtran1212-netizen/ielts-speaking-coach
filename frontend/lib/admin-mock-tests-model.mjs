const TEXT = (value) => typeof value === 'string' ? value.trim() : '';

export const MOCK_TEST_TABS = Object.freeze(['manage', 'live', 'review', 'writing']);
export const MOCK_TEST_STAGES = Object.freeze(['all', 'draft', 'live', 'closed']);

export function mockTestsTab(value) {
  const tab = TEXT(value);
  return MOCK_TEST_TABS.includes(tab) ? tab : 'manage';
}

export function mockTestsStage(value) {
  const stage = TEXT(value);
  return MOCK_TEST_STAGES.includes(stage) ? stage : 'all';
}

export function normalizeMockExam(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = TEXT(raw.id);
  if (!id) return null;
  return {
    id,
    code: TEXT(raw.code),
    title: TEXT(raw.title),
    status: TEXT(raw.status) || 'draft',
    isOpen: raw.is_open === true,
    activeSection: TEXT(raw.active_section) || 'not_started',
    examMode: TEXT(raw.exam_mode) || 'sequential',
  };
}

export function normalizeMockExamList(raw) {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray(raw.exams)
      ? raw.exams
      : null;
  if (!source) return null;
  const rows = [];
  const seen = new Set();
  let malformedCount = 0;
  for (const item of source) {
    const row = normalizeMockExam(item);
    if (!row || seen.has(row.id)) {
      malformedCount += 1;
      continue;
    }
    seen.add(row.id);
    rows.push(row);
  }
  return { rows, malformedCount };
}

export function mockExamStage(exam) {
  if (!exam || exam.status !== 'published') return 'draft';
  return exam.isOpen ? 'live' : 'closed';
}

export function filterMockExams(exams, stage) {
  const canonical = mockTestsStage(stage);
  return canonical === 'all' ? exams : exams.filter((exam) => mockExamStage(exam) === canonical);
}

export function mockTestsHref(tab, examId = '') {
  const canonical = mockTestsTab(tab);
  if (canonical === 'manage') return '/admin/mock-tests';
  const query = new URLSearchParams({ tab: canonical });
  const id = TEXT(examId);
  if ((canonical === 'live' || canonical === 'review') && id) query.set('exam_id', id);
  return `/admin/mock-tests?${query}`;
}

export function mockTestsFrame(tab, examId) {
  const canonical = mockTestsTab(tab);
  const id = TEXT(examId);
  if (canonical === 'manage') return '/admin/mock-exams?embed=1';
  if (canonical === 'writing') return '/admin/writing/queue?embed=1&mocklane=1';
  if (!id) return null;
  if (canonical === 'live') {
    return `/pages/admin/mock-live/index.html?exam_id=${encodeURIComponent(id)}&embed=1`;
  }
  return `/pages/admin/mock-reviews/index.html?mock_exam_id=${encodeURIComponent(id)}&embed=1`;
}
