export const WRITING_TASK_LABELS = Object.freeze({
  task1_academic: 'Task 1 (Academic)',
  task1_general: 'Task 1 (General)',
  task2: 'Task 2',
});

export function formatWritingDate(value) {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export function countWritingWords(value) {
  const text = String(value || '').trim();
  return text ? text.split(/\s+/).length : 0;
}

export function classifyWritingResult(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const essay = data.essay || data;
  const feedback = data.feedback || null;

  if (essay?.is_flagged) return { kind: 'flagged', essay, feedback: null };
  if (essay?.status !== 'delivered' || !feedback) {
    return { kind: 'not-delivered', essay, feedback: null };
  }
  return {
    kind: 'ready',
    essay,
    feedback,
    instructorNote: data.instructor_note || '',
    feedbackJson: feedback.feedback_json || {},
  };
}

export function writingBandLabel(feedback, feedbackJson) {
  const value = feedback?.overall_band_score ?? feedbackJson?.overallBandScore;
  return value == null ? 'Band —' : `Band ${value}`;
}

function normalizeFixKey(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
    : '';
}

// The grader writes `criterion` as free text ("Grammatical Range", "GRA",
// "Từ vựng" …); map it to the criteriaFeedback key that holds its band.
const FIX_CRITERION_KEYWORDS = [
  ['grammaticalRange', ['grammar', 'grammatical', 'ngữ pháp'], ['gra']],
  ['lexicalResource', ['lexical', 'vocab', 'từ vựng'], ['lr']],
  ['coherenceCohesion', ['coherence', 'cohesion', 'mạch lạc', 'liên kết'], ['cc']],
  ['mainCriterion', ['task', 'achievement', 'response'], ['tr', 'ta']],
];

function fixCriterionBand(criterion, criteriaFeedback) {
  const text = normalizeFixKey(criterion);
  if (!text) return null;
  const entry = FIX_CRITERION_KEYWORDS.find(([, words, abbrs]) =>
    abbrs.includes(text) || words.some((word) => text.includes(word)));
  const band = entry ? criteriaFeedback?.[entry[0]]?.bandScore : null;
  return typeof band === 'number' && Number.isFinite(band) ? band : null;
}

// R3 "N việc cần sửa trước": at most `limit` groups of mistakeAnalysis by
// mistakeType, weakest criterion band first, then larger group, then first
// appearance; topped up from keyTakeaways.areasForImprovement. AI text is
// passed through untouched.
export function writingTopFixes(feedbackJson, limit = 3) {
  const fj = feedbackJson && typeof feedbackJson === 'object' ? feedbackJson : {};
  const groups = new Map();
  (Array.isArray(fj.mistakeAnalysis) ? fj.mistakeAnalysis : []).forEach((mistake) => {
    if (!mistake || typeof mistake !== 'object') return;
    const key = normalizeFixKey(mistake.mistakeType);
    if (!key) return;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      return;
    }
    groups.set(key, {
      first: mistake,
      count: 1,
      order: groups.size,
      band: fixCriterionBand(mistake.criterion, fj.criteriaFeedback),
    });
  });

  const fixes = [...groups.values()]
    .sort((a, b) => {
      if (a.band !== b.band) {
        if (a.band == null) return 1;
        if (b.band == null) return -1;
        return a.band - b.band;
      }
      return b.count - a.count || a.order - b.order;
    })
    .slice(0, limit)
    .map(({ first, count }) => {
      const suggestion = typeof first.suggestion === 'string' ? first.suggestion.trim() : '';
      const explanation = typeof first.explanation === 'string' ? first.explanation.trim() : '';
      const example = typeof first.original === 'string' ? first.original.trim() : '';
      return {
        kind: 'mistake',
        title: first.mistakeType.trim(),
        detail: suggestion || explanation,
        ...(example ? { example } : {}),
        count,
      };
    });

  const seen = new Set(fixes.map((fix) => normalizeFixKey(fix.title)));
  const areas = Array.isArray(fj.keyTakeaways?.areasForImprovement)
    ? fj.keyTakeaways.areasForImprovement : [];
  for (const area of areas) {
    if (fixes.length >= limit) break;
    const key = normalizeFixKey(area);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fixes.push({ kind: 'area', title: area.trim(), detail: '', count: 1 });
  }
  return fixes;
}

export function essayTaskToTipTask(taskType) {
  if (taskType === 'task2') return 'task_2';
  if (taskType === 'task1_academic' || taskType === 'task1_general') return 'task_1';
  return null;
}

export function selectWritingTips(tips, taskType, limit = 3) {
  const wanted = essayTaskToTipTask(taskType);
  return (Array.isArray(tips) ? tips : [])
    .filter((tip) => tip?.task_type === wanted || tip?.task_type === 'both')
    .slice(0, limit);
}

export function writingTipPreview(markdown, limit = 110) {
  const text = String(markdown || '')
    .replace(/[#>*_`~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit).trim()}…` : text;
}

export function regradeStatusText(request) {
  if (!request) return '';
  if (request.status === 'pending') {
    return '⏳ Đã gửi yêu cầu chấm lại — chờ giảng viên phản hồi.';
  }
  if (request.status === 'rejected') {
    return `Yêu cầu chấm lại bị từ chối: ${request.admin_response || '—'}`;
  }
  if (request.status === 'fulfilled') {
    return '✓ Bài đã được chấm lại theo yêu cầu của em.';
  }
  return '';
}

export function selectWritingResultView(resultState, requestKey) {
  if (resultState?.key === requestKey && resultState.value) return resultState.value;
  return { kind: 'loading' };
}
