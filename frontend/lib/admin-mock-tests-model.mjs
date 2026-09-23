const TEXT = (value) => typeof value === 'string' ? value.trim() : '';

export const MOCK_TEST_TABS = Object.freeze(['manage', 'live', 'review', 'writing']);
export const MOCK_TEST_STAGES = Object.freeze(['all', 'draft', 'live', 'closed', 'archived']);

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
    reviewEligible: typeof raw.review_eligible === 'boolean' ? raw.review_eligible : null,
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
  if (!exam) return 'draft';
  if (exam.status === 'archived') return 'archived';
  if (exam.status !== 'published') return 'draft';
  return exam.isOpen ? 'live' : 'closed';
}

export function filterMockExams(exams, stage) {
  const canonical = mockTestsStage(stage);
  return canonical === 'all' ? exams : exams.filter((exam) => mockExamStage(exam) === canonical);
}

export function mockTestsStageForTab(tab) {
  const canonical = mockTestsTab(tab);
  if (canonical === 'live') return 'live';
  return 'all';
}

export function mockReviewEligibilityUnknown(exam) {
  return exam != null
    && (exam.examMode === 'retake' || exam.status !== 'published')
    && exam.reviewEligible === null;
}

export function mockReviewEligible(exam) {
  if (!exam) return false;
  if (typeof exam.reviewEligible === 'boolean') return exam.reviewEligible;
  // Old-backend compatibility: the sequential exam clock is still canonical,
  // but an old response cannot tell us whether row-backed work remains.
  return exam.status === 'published'
    && exam.examMode !== 'retake'
    && exam.isOpen === false
    && exam.activeSection === 'done';
}

export function mockTestsExamForTab(exams, tab, currentId = '', requestedId = '') {
  const rows = Array.isArray(exams) ? exams : [];
  const canonical = mockTestsTab(tab);
  const requested = TEXT(requestedId);
  const current = TEXT(currentId);
  if (requested && rows.some((exam) => exam.id === requested)) return requested;
  if (canonical === 'writing') return '';
  const allowed = canonical === 'live'
    ? rows.filter((exam) => mockExamStage(exam) === 'live')
    : canonical === 'review'
      ? rows.filter(mockReviewEligible)
      : rows;
  return allowed.some((exam) => exam.id === current) ? current : allowed[0]?.id || '';
}

export function mockSectionLabel(value) {
  const key = TEXT(value);
  return ({
    not_started: 'Chưa bắt đầu',
    listening: 'Listening',
    reading: 'Reading',
    writing: 'Writing',
    done: 'Đã xong',
  })[key] || 'Không rõ trạng thái';
}

export function mockSittingStatusLabel(value) {
  const key = TEXT(value);
  return ({
    'chưa vào': 'Chưa vào phòng',
    registered: 'Đã đăng ký',
    lrw_in_progress: 'Đang làm LRW',
    lrw_submitted: 'Đã nộp LRW',
    speaking_pending: 'Chờ thi Speaking',
    all_submitted: 'Đã nộp đủ',
    under_review: 'Đang chấm',
    reviewed: 'Đã chấm',
    released: 'Đã trả kết quả',
    void: 'Đã huỷ lượt',
  })[key] || 'Không rõ trạng thái';
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
    return `/admin/mock-live?exam_id=${encodeURIComponent(id)}&embed=1`;
  }
  return `/admin/mock-reviews?mock_exam_id=${encodeURIComponent(id)}&embed=1`;
}
