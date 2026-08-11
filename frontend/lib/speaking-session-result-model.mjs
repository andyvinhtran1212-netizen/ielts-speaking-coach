// Pure view-model for the native `/result` route.
//
// The backend session row is the canonical source for finalized session bands.
// Per-response feedback is used for qualitative detail and only as a backwards-
// compatibility fallback for completed legacy rows whose aggregate columns were
// never backfilled.

const BAND_KEYS = Object.freeze(['fc', 'lr', 'gra', 'p']);

const GRAMMAR_CATEGORY_LABELS = Object.freeze({
  tense: 'Thì động từ',
  article: 'Mạo từ',
  preposition: 'Giới từ',
  missing_subject: 'Thiếu chủ ngữ',
  subject_verb_agreement: 'Sự hòa hợp chủ - động',
  verb_form: 'Dạng động từ',
  copula: 'Động từ to be',
  vocabulary: 'Từ vựng',
  punctuation: 'Dấu câu',
  spelling: 'Chính tả',
  style: 'Văn phong',
  grammar: 'Ngữ pháp',
  other: 'Khác',
});

const GRAMMAR_KEYWORDS = Object.freeze([
  ['articles', 'mạo từ', ['article', ' a ', ' an ', ' the ', 'definite', 'indefinite', 'mạo từ']],
  ['present-perfect', 'thì hiện tại hoàn thành', ['present perfect', 'have been', 'has been', 'have + past participle', 'for and since', 'already', 'just', 'yet']],
  ['present-continuous', 'thì hiện tại tiếp diễn', ['present continuous', 'present progressive', 'is + v-ing', 'are + v-ing', 'am + v-ing']],
  ['present-simple', 'thì hiện tại đơn', ['present simple', 'simple present', 'third person', 's-form', 'frequency adverb']],
  ['past-simple', 'thì quá khứ đơn', ['past simple', 'simple past', 'past tense', 'irregular verb', 'regular verb', 'v2']],
  ['future-forms', 'thì tương lai', ['future', 'going to', "won't", 'will be']],
  ['gerund', 'danh động từ', ['gerund', 'v-ing form', '-ing form', 'enjoy', 'avoid', 'finish', 'after preposition']],
  ['infinitive', 'to-infinitive', ['to-infinitive', 'to infinitive', 'want to', 'hope to', 'plan to', 'decide to', 'need to']],
  ['bare-infinitive', 'bare infinitive', ['bare infinitive', 'modal verb', 'after modal', 'can swim', 'should study', 'must use']],
  ['gerund-vs-infinitive', 'gerund và infinitive', ['gerund or infinitive', 'gerund vs infinitive', 'stop doing', 'stop to', 'remember doing', 'remember to', 'try doing', 'try to']],
  ['adjectives', 'tính từ', ['adjective', 'describing noun', 'attributive', 'predicative']],
  ['adverbs', 'trạng từ', ['adverb', 'adverbs', 'manner adverb', 'frequency adverb', 'adverbial']],
  ['adjective-vs-adverb', 'tính từ và trạng từ', ['adjective or adverb', 'adjective vs adverb', 'adjective instead of adverb', 'good or well', 'linking verb', 'look good', 'feel bad', 'sounds great']],
  ['sentence-elements', 'thành phần câu', ['subject', 'subject-verb agreement', 'verb agreement', 'sentence element', 'subject and verb']],
  ['countable-vs-uncountable', 'danh từ đếm được', ['countable', 'uncountable', 'count noun', 'mass noun', 'much or many', 'little or few']],
  ['singular-vs-plural', 'số ít / số nhiều', ['singular', 'plural', 'singular verb', 'plural verb', 'verb agreement']],
  ['compound-sentence', 'câu ghép', ['compound sentence', 'coordinating conjunction', 'fanboys', 'run-on sentence']],
  ['complex-sentence', 'câu phức', ['complex sentence', 'subordinate', 'subordinating conjunction', 'relative clause', 'because', 'although', 'even though']],
]);

const GRAMMAR_META_FALLBACK = Object.freeze({
  articles: ['foundations', 'Articles (a / an / the)', 'Dùng đúng mạo từ trong mọi ngữ cảnh'],
  'present-perfect': ['tenses', 'Present Perfect', 'Hiện tại hoàn thành — cấu trúc, cách dùng và phân biệt với past simple'],
  'present-continuous': ['tenses', 'Present Continuous', 'Thì hiện tại tiếp diễn — hành động đang xảy ra hoặc kế hoạch tương lai'],
  'present-simple': ['tenses', 'Present Simple', 'Thì hiện tại đơn — thói quen, sự thật và trạng thái thường trực'],
  'past-simple': ['tenses', 'Past Simple', 'Thì quá khứ đơn — sự kiện và hành động đã hoàn thành'],
  'future-forms': ['tenses', 'Future Forms', 'Các dạng tương lai — will, going to và present continuous'],
  gerund: ['verb-patterns', 'Gerund (V-ing)', 'Danh động từ — khi nào dùng V-ing thay vì to-infinitive'],
  infinitive: ['verb-patterns', 'To-Infinitive', 'Động từ nguyên thể có “to” — cấu trúc và cách dùng'],
  'bare-infinitive': ['verb-patterns', 'Bare Infinitive', 'Động từ nguyên thể không có “to” — sau modal verbs và let/make'],
  'gerund-vs-infinitive': ['verb-patterns', 'Gerund vs. Infinitive', 'Khi nào dùng V-ing, khi nào dùng to-V — và các động từ có nghĩa khác nhau'],
  adjectives: ['modifiers', 'Adjectives', 'Tính từ — vị trí, thứ tự và cách dùng trong tiếng Anh'],
  adverbs: ['modifiers', 'Adverbs', 'Trạng từ — các loại và vị trí đúng trong câu'],
  'adjective-vs-adverb': ['modifiers', 'Adjective vs. Adverb', 'Phân biệt tính từ và trạng từ — lỗi phổ biến nhất trong speaking'],
  'sentence-elements': ['foundations', 'Sentence Elements', 'Các thành phần câu cơ bản — subject, verb, object, complement'],
  'countable-vs-uncountable': ['foundations', 'Countable vs. Uncountable', 'Danh từ đếm được và không đếm được — dùng how much hay how many?'],
  'singular-vs-plural': ['foundations', 'Singular & Plural', 'Số ít và số nhiều — cách chia động từ cho đúng'],
  'compound-sentence': ['sentence-structures', 'Compound Sentence', 'Câu ghép — nối hai mệnh đề độc lập bằng coordinating conjunctions'],
  'complex-sentence': ['sentence-structures', 'Complex Sentence', 'Câu phức — mệnh đề chính và mệnh đề phụ thuộc'],
});

export function parseFeedback(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function numeric(value) {
  if (value == null || value === '') return null;
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

export function safeMediaUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:', 'blob:'].includes(parsed.protocol) ? raw : '';
  } catch (_) {
    return '';
  }
}

export function roundHalf(value) {
  const out = numeric(value);
  return out == null ? null : Math.round(out * 2) / 2;
}

export function bandClass(value) {
  const band = numeric(value);
  if (band == null) return 'band-none';
  if (band >= 7) return 'band-high';
  if (band >= 6) return 'band-mid';
  if (band >= 5) return 'band-warn';
  return 'band-low';
}

function uniqueStrings(values, max = Infinity) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = String(value == null ? '' : value).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function aggregateResponseBands(responses) {
  const sums = { fc: 0, lr: 0, gra: 0, p: 0 };
  const counts = { fc: 0, lr: 0, gra: 0, p: 0 };
  for (const response of responses) {
    const feedback = parseFeedback(response?.feedback);
    if (!feedback) continue;
    for (const key of BAND_KEYS) {
      const value = key === 'p'
        ? numeric(response?.final_band_p) ?? numeric(feedback.band_p)
        : numeric(feedback[`band_${key}`]);
      if (value == null) continue;
      sums[key] += value;
      counts[key] += 1;
    }
  }
  return Object.fromEntries(BAND_KEYS.map((key) => [
    key,
    counts[key] ? roundHalf(sums[key] / counts[key]) : null,
  ]));
}

function aggregateLists(responses) {
  const strengths = [];
  const improvements = [];
  const weaknesses = [];
  let grammarCount = 0;
  let vocabCount = 0;
  let hasSample = false;
  for (const response of responses) {
    const feedback = parseFeedback(response?.feedback);
    if (!feedback) continue;
    strengths.push(...(Array.isArray(feedback.strengths) ? feedback.strengths : []));
    improvements.push(...(Array.isArray(feedback.improvements) ? feedback.improvements : []));
    const grammar = Array.isArray(feedback.grammar_issues) ? feedback.grammar_issues : [];
    const vocab = Array.isArray(feedback.vocabulary_issues) ? feedback.vocabulary_issues : [];
    weaknesses.push(...grammar, ...vocab);
    grammarCount += grammar.length;
    vocabCount += vocab.length;
    hasSample ||= Boolean(feedback.sample_answer);
  }
  let takeaway = '';
  if (grammarCount || vocabCount) {
    takeaway = grammarCount >= vocabCount
      ? 'Ưu tiên sửa các lỗi ngữ pháp được đánh dấu trong từng câu trả lời'
      : 'Ưu tiên mở rộng vốn từ và dùng từ vựng chính xác hơn';
    takeaway += hasSample
      ? ', rồi luyện nói lại theo câu trả lời mẫu để củng cố.'
      : ', rồi luyện nói lại để củng cố.';
  }
  return {
    strengths: uniqueStrings(strengths, 5),
    improvements: uniqueStrings(improvements, 5),
    weaknesses: uniqueStrings(weaknesses, 5),
    takeaway,
  };
}

export function transcriptSegments(transcript, grammarCheck) {
  const raw = String(transcript == null ? '' : transcript);
  const errors = Array.isArray(grammarCheck?.errors) ? grammarCheck.errors : [];
  const spans = errors
    .filter((error) => Number.isInteger(error?.transcript_offset_start)
      && Number.isInteger(error?.transcript_offset_end)
      && error.transcript_offset_start >= 0
      && error.transcript_offset_end > error.transcript_offset_start
      && error.transcript_offset_end <= raw.length)
    .slice()
    .sort((a, b) => a.transcript_offset_start - b.transcript_offset_start);
  const out = [];
  let cursor = 0;
  for (const error of spans) {
    const start = error.transcript_offset_start;
    const end = error.transcript_offset_end;
    if (start < cursor) continue;
    if (start > cursor) out.push({ kind: 'text', text: raw.slice(cursor, start) });
    out.push({
      kind: 'error',
      text: raw.slice(start, end),
      id: `${start}-${end}`,
      suggestion: String(error.suggestion || ''),
      explanation: String(error.explanation_vn || ''),
    });
    cursor = end;
  }
  if (cursor < raw.length) out.push({ kind: 'text', text: raw.slice(cursor) });
  return out.length ? out : [{ kind: 'text', text: raw }];
}

function grammarGroups(grammarCheck) {
  const errors = Array.isArray(grammarCheck?.errors) ? grammarCheck.errors : [];
  const groups = [];
  const byCategory = new Map();
  for (const error of errors) {
    const category = String(error?.category || 'other');
    if (!byCategory.has(category)) {
      const group = {
        category,
        label: GRAMMAR_CATEGORY_LABELS[category] || category,
        errors: [],
      };
      byCategory.set(category, group);
      groups.push(group);
    }
    byCategory.get(category).errors.push({
      id: `${error?.transcript_offset_start ?? ''}-${error?.transcript_offset_end ?? ''}`,
      original: String(error?.original_text || ''),
      suggestion: String(error?.suggestion || '(?)'),
      explanation: String(error?.explanation_vn || ''),
    });
  }
  const total = numeric(grammarCheck?.total_count);
  const displayed = numeric(grammarCheck?.displayed_count);
  return {
    groups,
    moreCount: total != null && displayed != null && total > displayed ? total - displayed : 0,
  };
}

function warnings(feedback) {
  const out = [];
  if (feedback?.off_topic_verdict?.is_on_topic === false) {
    const reason = String(feedback.off_topic_verdict.reasoning || '').trim();
    out.push({
      icon: '⚠️',
      message: 'Cảnh báo: Câu trả lời có thể chưa bám sát đề, nên band cho câu này đã bị giới hạn (không phản ánh năng lực thật của bạn).'
        + (reason ? ` Lý do: ${reason}` : ''),
    });
  }
  if (feedback?.length_warning === true) {
    const duration = numeric(feedback.audio_duration_seconds);
    const threshold = numeric(feedback.length_soft_threshold);
    out.push({
      icon: '⏱️',
      message: `Cảnh báo: Câu trả lời chỉ ${duration == null ? '?' : duration.toFixed(1)}s, ngắn hơn ngưỡng tham khảo ${threshold == null ? '?' : Math.round(threshold)}s. Có thể giới hạn band tối đa.`,
    });
  }
  return out;
}

function responseBandPills(response, feedback, isPractice) {
  if (!feedback) return [];
  if (isPractice) {
    const band = numeric(response?.final_overall_band) ?? numeric(feedback.overall_band);
    return band == null ? [] : [{ key: 'overall', label: 'Band', value: roundHalf(band) }];
  }
  return BAND_KEYS.flatMap((key) => {
    const value = key === 'p'
      ? numeric(response?.final_band_p) ?? numeric(feedback.band_p)
      : numeric(feedback[`band_${key}`]);
    return value == null ? [] : [{ key, label: key.toUpperCase(), value: roundHalf(value) }];
  });
}

function responseCards(questions, responses, audioUrlMap) {
  const byQuestion = new Map(responses.map((response) => [String(response?.question_id || ''), response]));
  return questions.map((question, index) => {
    const response = byQuestion.get(String(question?.id || '')) || null;
    const feedback = parseFeedback(response?.feedback);
    const gradingFailed = Boolean(response) && (
      response?.grading_status === 'failed' || !feedback || feedback?._failed === true
    );
    const isPractice = Boolean(feedback && Array.isArray(feedback.grammar_issues));
    let statusMessage = '';
    if (gradingFailed) {
      statusMessage = response?.grading_status === 'failed'
        ? 'Hệ thống chấm điểm gặp lỗi với câu trả lời này.'
        : response?.stt_status === 'failed'
          ? 'Không nhận dạng được giọng nói (STT thất bại).'
          : 'Chấm điểm chưa hoàn thành. Vui lòng thử lại sau.';
    }
    const grammar = grammarGroups(feedback?.grammar_check);
    return {
      key: String(question?.id || index),
      questionId: String(question?.id || ''),
      questionText: String(question?.question_text || ''),
      response,
      feedback,
      gradingFailed,
      statusMessage,
      isPractice,
      bandPills: responseBandPills(response, feedback, isPractice),
      warnings: warnings(feedback),
      transcript: response?.transcript
        ? transcriptSegments(response.transcript, feedback?.grammar_check)
        : [],
      grammarGroups: grammar.groups,
      grammarMoreCount: grammar.moreCount,
      audioUrl: safeMediaUrl(
        audioUrlMap[String(question?.id || '')] || response?.audio_url || '',
      ),
      audioFilename: `recording-q${index + 1}.webm`,
    };
  });
}

function articleIndex(categoriesPayload) {
  const out = new Map();
  for (const category of Array.isArray(categoriesPayload?.categories) ? categoriesPayload.categories : []) {
    for (const article of Array.isArray(category?.articles) ? category.articles : []) {
      if (!article?.slug) continue;
      out.set(String(article.slug), {
        category: String(article.category || category?.slug || ''),
        title: String(article.title || article.slug),
        summary: String(article.summary || ''),
      });
    }
  }
  return out;
}

function fallbackMeta(slug) {
  const item = GRAMMAR_META_FALLBACK[slug];
  return item ? { category: item[0], title: item[1], summary: item[2] } : null;
}

function grammarFallbackTexts(responses) {
  const buckets = { gi: [], co: [], im: [], gf: [] };
  for (const response of responses) {
    const feedback = parseFeedback(response?.feedback);
    if (!feedback) continue;
    buckets.gi.push(...(Array.isArray(feedback.grammar_issues) ? feedback.grammar_issues : []));
    for (const correction of Array.isArray(feedback.corrections) ? feedback.corrections : []) {
      buckets.co.push(correction?.explanation, correction?.original, correction?.corrected);
    }
    buckets.im.push(...(Array.isArray(feedback.improvements) ? feedback.improvements : []));
    buckets.im.push(feedback.improved_response);
    buckets.gf.push(feedback.gra_feedback);
  }
  return Object.fromEntries(Object.entries(buckets).map(([key, values]) => [
    key,
    values.filter(Boolean).join(' ').toLowerCase(),
  ]));
}

function grammarReason(field, topic) {
  const suffix = topic ? ` về ${topic}` : '';
  if (field === 'gi') return `Gợi ý vì bài có lỗi ngữ pháp${suffix}`;
  if (field === 'co') return `Gợi ý vì có correction liên quan${suffix}`;
  if (field === 'im') return `Gợi ý để cải thiện${suffix}`;
  return `Gợi ý dựa trên grammar feedback${suffix}`;
}

export function grammarResources(responses, categoriesPayload) {
  const index = articleIndex(categoriesPayload);
  const seen = new Set();
  const canonical = [];
  let sawCanonical = false;
  for (const response of responses) {
    const feedback = parseFeedback(response?.feedback);
    const recommendations = Array.isArray(feedback?.grammar_recommendations)
      ? feedback.grammar_recommendations
      : [];
    sawCanonical ||= recommendations.length > 0;
    for (const rec of recommendations) {
      const slug = String(rec?.slug || '');
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const meta = index.get(slug) || fallbackMeta(slug) || {
        category: String(rec?.category || ''),
        title: String(rec?.title || slug),
        summary: '',
      };
      if (!meta.category) continue;
      canonical.push({
        slug,
        ...meta,
        anchor: String(rec?.anchor || ''),
        recId: String(rec?.rec_id || ''),
        reason: grammarReason('gi', String(rec?.issue || '')),
        source: 'canonical',
      });
      if (canonical.length === 3) return canonical;
    }
  }
  // Backend recommendations are the canonical source. If they exist but are
  // malformed/stale, empty is safer than replacing them with a client guess.
  if (canonical.length || sawCanonical) return canonical;

  const texts = grammarFallbackTexts(responses);
  const scored = [];
  for (const [slug, topic, keywords] of GRAMMAR_KEYWORDS) {
    const scores = { gi: 0, co: 0, im: 0, gf: 0 };
    for (const keyword of keywords) {
      const term = keyword.toLowerCase();
      if (texts.gi.includes(term)) scores.gi += 4;
      if (texts.co.includes(term)) scores.co += 3;
      if (texts.im.includes(term)) scores.im += 2;
      if (texts.gf.includes(term)) scores.gf += 1;
    }
    const score = scores.gi + scores.co + scores.im + scores.gf;
    const meta = index.get(slug) || fallbackMeta(slug);
    if (!score || !meta) continue;
    const field = Object.entries(scores).reduce((best, current) => (
      current[1] > best[1] ? current : best
    ), ['gi', scores.gi])[0];
    scored.push({
      slug,
      ...meta,
      anchor: '',
      recId: '',
      reason: grammarReason(field, topic),
      source: 'fallback',
      score,
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 3);
}

export function buildSessionResult(session, categoriesPayload = null, audioItems = []) {
  const responses = Array.isArray(session?.responses) ? session.responses : [];
  const questions = Array.isArray(session?.questions) ? session.questions : [];
  const isCompleted = session?.status === 'completed';
  const isPractice = responses.some((response) => (
    Array.isArray(parseFeedback(response?.feedback)?.grammar_issues)
  ));
  const canonicalBands = Object.fromEntries(BAND_KEYS.map((key) => [
    key,
    numeric(session?.[`band_${key}`]),
  ]));
  const hasAnyCanonicalBand = BAND_KEYS.some((key) => canonicalBands[key] != null);
  const legacyFallbackComplete = responses.length > 0 && responses.every((response) => {
    const feedback = parseFeedback(response?.feedback);
    return response?.grading_status === 'completed'
      && Boolean(feedback)
      && feedback?._failed !== true;
  });
  const legacyBands = isCompleted && !hasAnyCanonicalBand && legacyFallbackComplete
    ? aggregateResponseBands(responses)
    : {};
  const bands = Object.fromEntries(BAND_KEYS.map((key) => [
    key,
    canonicalBands[key] ?? legacyBands[key] ?? null,
  ]));
  const overall = numeric(session?.overall_band);
  const lists = aggregateLists(responses);
  const audioUrlMap = Object.fromEntries((Array.isArray(audioItems) ? audioItems : [])
    .filter((item) => item?.question_id && item?.url)
    .map((item) => [String(item.question_id), String(item.url)]));

  const explicitSeal = typeof session?.results_sealed === 'boolean'
    ? session.results_sealed
    : null;
  const legacyReceiptSeal = Boolean(session?.sitting_id && responses.length === 0
    && Array.isArray(session?.response_receipts) && session.response_receipts.length > 0);
  const isSealed = explicitSeal ?? legacyReceiptSeal;

  return {
    sessionId: String(session?.id || session?.session_id || ''),
    part: session?.part == null ? '?' : String(session.part),
    topic: String(session?.topic || ''),
    mode: String(session?.mode || 'practice'),
    status: String(session?.status || ''),
    startedAt: session?.started_at || session?.created_at || null,
    isCompleted,
    isPractice,
    isSealed,
    overall,
    bands,
    strengths: lists.strengths,
    improvements: isPractice ? lists.weaknesses : lists.improvements,
    takeaway: isCompleted && isPractice ? lists.takeaway : '',
    cards: isSealed ? [] : responseCards(questions, responses, audioUrlMap),
    grammarResources: grammarResources(responses, categoriesPayload),
  };
}
