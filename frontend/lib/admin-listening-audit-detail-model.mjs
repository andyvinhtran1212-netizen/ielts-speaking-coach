const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const exactText = (value) => typeof value === 'string' ? value : null;
const integer = (value) => typeof value === 'number' && Number.isInteger(value) ? value : null;
const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const nullableText = (value) => textOf(value) || null;
const STATUSES = new Set(['draft', 'published', 'archived']);
const TYPES = new Set(['full', 'mini', 'drill', 'practice']);
const AUDIT_STATUSES = new Set(['pending', 'passed', 'has_issues', 'fixed']);

function stringList(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return value.map((item) => item.trim()).filter(Boolean);
}

function repairableOptions(value) {
  const warnings = [];
  if (value == null) return { value: [], warnings, unreadable: false };
  if (!Array.isArray(value)) return { value: [], warnings: ['Options canonical không phải array; cần nhập lại trước khi lưu.'], unreadable: true };
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const option = objectOf(raw);
    const letter = textOf(option?.letter).toUpperCase(); const text = exactText(option?.text) ?? '';
    if (!option || !/^[A-H]$/.test(letter) || !text.trim() || seen.has(letter)) warnings.push('Options canonical có dòng rỗng, sai ký tự hoặc trùng ký tự; hãy sửa các dòng được hiển thị.');
    seen.add(letter); out.push({ letter, text });
  }
  return { value: out, warnings: [...new Set(warnings)], unreadable: false };
}

function repairableWindow(raw) {
  if (raw == null) return { value: null, warnings: [] };
  const value = objectOf(raw);
  if (!value) return { value: null, warnings: ['Audio window canonical sai shape; hãy nhập lại start/end.'] };
  const start = finite(value?.start); const end = finite(value?.end);
  const warnings = start == null || end == null || start < 0 || end <= start
    ? ['Audio window canonical không hợp lệ; hãy sửa start/end trước khi nghe hoặc lưu.'] : [];
  return { value: { start, end, section: nullableText(value.section) }, warnings };
}

function normalizeIssue(raw, { live = false } = {}) {
  const value = objectOf(raw);
  const qNum = value?.q_num == null ? null : integer(value.q_num);
  const severity = textOf(value?.severity);
  const source = textOf(value?.source);
  if (!value || (value.q_num != null && (qNum == null || qNum < 1))
    || !['error', 'warning'].includes(severity) || !['structural', 'llm'].includes(source)
    || (live && source !== 'structural') || !textOf(value.dimension) || !textOf(value.code)
    || !textOf(value.message) || typeof value.resolved !== 'boolean') return null;
  return { index: null, qNum, severity, source, dimension: textOf(value.dimension),
    code: textOf(value.code), message: textOf(value.message), resolved: value.resolved };
}

function normalizeHealth(raw, issues = null, allowEmpty = false) {
  const value = objectOf(raw);
  if (allowEmpty && value && Object.keys(value).length === 0) return null;
  const errorCount = integer(value?.error_count); const warningCount = integer(value?.warning_count);
  const status = textOf(value?.status);
  if (!value || errorCount == null || errorCount < 0 || warningCount == null || warningCount < 0
    || !['passed', 'has_issues'].includes(status) || (errorCount > 0) !== (status === 'has_issues')) return null;
  if (issues) {
    if (issues.filter((issue) => issue.severity === 'error' && !issue.resolved).length !== errorCount
      || issues.filter((issue) => issue.severity === 'warning' && !issue.resolved).length !== warningCount) return null;
  }
  return { errorCount, warningCount, status, requestId: nullableText(value.request_id) };
}

function normalizeQuestion(raw) {
  const value = objectOf(raw); const parsedQNum = integer(value?.q_num);
  const qNum = parsedQNum != null && parsedQNum >= 1 ? parsedQNum : null;
  const options = repairableOptions(value?.options); const alternatives = stringList(value?.alternatives);
  const traps = stringList(value?.trap_mechanisms); const audioWindow = repairableWindow(value?.audio_window);
  if (!value || !textOf(value.exercise_id) || !textOf(value.exercise_updated_at)) return null;
  const warnings = [...options.warnings, ...audioWindow.warnings];
  const requiredRepairs = [];
  if (exactText(value.prompt) == null) warnings.push('Prompt canonical không phải chuỗi; editor dùng bản rỗng để sửa.');
  if (exactText(value.answer) == null) warnings.push('Đáp án canonical không phải chuỗi; editor dùng bản rỗng để sửa.');
  if (alternatives == null) { warnings.push('Alternatives canonical sai shape; cần nhập lại trước khi lưu.'); requiredRepairs.push('alternatives'); }
  if (traps == null) { warnings.push('Trap mechanisms canonical sai shape; cần nhập lại trước khi lưu.'); requiredRepairs.push('traps'); }
  if (options.unreadable) requiredRepairs.push('options');
  if (exactText(value.solution) == null) warnings.push('Giải thích canonical không phải chuỗi; editor dùng bản rỗng để sửa.');
  return { qNum, rawQNum: String(value.q_num ?? 'không có'), exerciseId: textOf(value.exercise_id), exerciseUpdatedAt: textOf(value.exercise_updated_at),
    templateKind: textOf(value.template_kind), prompt: exactText(value.prompt) ?? '', answer: exactText(value.answer) ?? '',
    alternatives: alternatives || [], trapMechanisms: traps || [], options: options.value,
    solution: exactText(value.solution) ?? '', audioWindow: audioWindow.value,
    repairWarnings: [...new Set(warnings)], requiredRepairs, editable: qNum != null, identityWarning: qNum == null ? 'q_num canonical không hợp lệ; không thể PATCH an toàn theo vị trí này.' : null };
}

function normalizeSection(raw) {
  const value = objectOf(raw); const sectionNum = integer(value?.section_num);
  const offset = finite(value?.audio_offset); const audioOffset = offset != null && offset >= 0 ? offset : null;
  const questionsRaw = Array.isArray(value?.questions) ? value.questions : null;
  if (!value || sectionNum == null || sectionNum < 1 || !textOf(value.content_id)
    || !textOf(value.content_updated_at) || exactText(value.transcript) == null || !questionsRaw) return null;
  const questions = questionsRaw.map(normalizeQuestion);
  if (questions.some((item) => !item)) return null;
  return { sectionNum, contentId: textOf(value.content_id), contentUpdatedAt: textOf(value.content_updated_at), audioOffset,
    transcript: value.transcript, questions };
}

export function normalizeListeningAuditDetail(raw, expectedId) {
  const value = objectOf(raw); const id = textOf(value?.uuid); const testId = textOf(value?.test_id);
  const status = textOf(value?.status); const type = textOf(value?.test_type);
  const questionCount = integer(value?.question_count); const sectionCount = integer(value?.section_count);
  const sectionsRaw = Array.isArray(value?.sections) ? value.sections : null;
  const live = objectOf(value?.live); const liveRaw = Array.isArray(live?.issues) ? live.issues : null;
  if (!value || id !== textOf(expectedId) || !testId || !STATUSES.has(status) || !TYPES.has(type)
    || questionCount == null || questionCount < 0 || sectionCount == null || sectionCount < 0
    || !sectionsRaw || !live || !liveRaw) return null;
  const normalizedSections = sectionsRaw.map(normalizeSection);
  const liveIssues = liveRaw.map((issue) => normalizeIssue(issue, { live: true }));
  if (normalizedSections.some((item) => !item) || liveIssues.some((item) => !item)
    || normalizedSections.length !== sectionCount || normalizedSections.reduce((sum, section) => sum + section.questions.length, 0) !== questionCount
    || new Set(normalizedSections.map((section) => section.sectionNum)).size !== normalizedSections.length
  ) return null;
  const qNumCounts = new Map();
  for (const section of normalizedSections) for (const question of section.questions) {
    if (question.qNum != null) qNumCounts.set(question.qNum, (qNumCounts.get(question.qNum) || 0) + 1);
  }
  const sections = normalizedSections.map((section, sectionIndex) => ({ ...section,
    questions: section.questions.map((question, questionIndex) => {
      const duplicate = question.qNum != null && qNumCounts.get(question.qNum) > 1;
      return { ...question, clientKey: `${question.exerciseId}:${sectionIndex}:${questionIndex}`,
        editable: question.editable && !duplicate,
        identityWarning: duplicate ? `q_num ${question.qNum} bị trùng; PATCH theo số câu sẽ mơ hồ nên card bị khóa.` : question.identityWarning };
    }),
  }));
  const liveHealth = normalizeHealth(live.health, liveIssues);
  if (!liveHealth) return null;

  let saved = null;
  if (value.saved != null) {
    const source = objectOf(value.saved); const savedStatus = textOf(source?.status);
    const savedRaw = Array.isArray(source?.issues) ? source.issues : null;
    if (!source || !AUDIT_STATUSES.has(savedStatus) || textOf(source.test_id) !== id
      || !textOf(source.updated_at) || !savedRaw) return null;
    const savedIssues = savedRaw.map((issue, index) => {
      const normalized = normalizeIssue(issue); return normalized ? { ...normalized, index } : null;
    });
    const savedHealth = normalizeHealth(source.health, null, savedStatus === 'pending');
    if (savedIssues.some((item) => !item) || (savedStatus !== 'pending' && !savedHealth)) return null;
    saved = { status: savedStatus, notes: exactText(source.notes) || '', auditor: nullableText(source.auditor), auditedAt: nullableText(source.audited_at),
      updatedAt: textOf(source.updated_at), health: savedHealth, issues: savedIssues };
  }
  return { id, testId, title: textOf(value.title) || testId, status, type, questionCount, sectionCount,
    sections, live: { health: liveHealth, issues: liveIssues }, saved };
}

function safeUrl(value) {
  const raw = textOf(value);
  try { const url = new URL(raw); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null; }
  catch { return null; }
}

export function normalizeListeningAuditAudio(raw) {
  const value = objectOf(raw); const sectionsRaw = Array.isArray(value?.sections) ? value.sections : null;
  if (!value || !sectionsRaw) return null;
  const sectionUrls = new Map();
  for (const rawSection of sectionsRaw) {
    const section = objectOf(rawSection); const num = integer(section?.section_num);
    const url = safeUrl(section?.signed_url);
    if (!section || num == null || num < 1 || sectionUrls.has(num)) return null;
    sectionUrls.set(num, url);
  }
  const assembled = safeUrl(objectOf(value.assembled)?.signed_url);
  const full = safeUrl(objectOf(value.full)?.signed_url);
  return { assembled, full, sectionUrls };
}

export function listeningAuditAudioForSection(audio, sectionNum) {
  return audio?.assembled || audio?.full || audio?.sectionUrls?.get(sectionNum) || null;
}

export function listeningAuditPlayback(audio, section, audioWindow) {
  if (!audio || !section || !audioWindow) return null;
  const start = finite(audioWindow.start); const end = finite(audioWindow.end);
  const declaredSection = textOf(audioWindow.section).toUpperCase();
  if (start == null || end == null || start < 0 || end <= start
    || (declaredSection && declaredSection !== `S${section.sectionNum}`)) return null;
  const globalUrl = audio.assembled || audio.full;
  if (globalUrl) return { url: globalUrl, start, end,
    source: audio.assembled ? 'assembled' : 'full' };
  const url = audio.sectionUrls?.get(section.sectionNum) || null;
  if (!url || finite(section.audioOffset) == null) return null;
  const localStart = start - section.audioOffset; const localEnd = end - section.audioOffset;
  if (localStart < 0 || localEnd <= localStart) return null;
  return { url, start: localStart, end: localEnd, source: 'section' };
}

export function parseListeningAuditOptions(input) {
  const lines = String(input ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const options = [];
  for (const line of lines) {
    const match = line.match(/^([A-H])\s*\|\s*(.+)$/i);
    if (!match) return { ok: false, error: 'Mỗi option cần dạng “A | nội dung”.' };
    const encoded = match[2].trim(); let optionText = encoded;
    if (encoded.startsWith('"')) {
      try { optionText = JSON.parse(encoded); } catch { return { ok: false, error: 'Nội dung option dạng JSON không hợp lệ.' }; }
      if (typeof optionText !== 'string' || !optionText.trim()) return { ok: false, error: 'Nội dung option phải là chuỗi không rỗng.' };
    }
    options.push({ letter: match[1].toUpperCase(), text: optionText });
  }
  if (new Set(options.map((option) => option.letter)).size !== options.length) return { ok: false, error: 'Ký tự option không được lặp.' };
  return { ok: true, value: options };
}

export const formatListeningAuditOptions = (options) => (options || []).map((option) => {
  const text = String(option.text ?? '');
  return `${option.letter} | ${/[\r\n\\]/.test(text) || text.startsWith('"') ? JSON.stringify(text) : text}`;
}).join('\n');
export const parseListeningAuditList = (input) => String(input ?? '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

export function buildListeningAuditQuestionPatch(draft, version) {
  if (Array.isArray(draft.requiredRepairs) && draft.requiredRepairs.length) return {
    ok: false,
    error: `Cần nhập lại field canonical không đọc được trước khi lưu: ${draft.requiredRepairs.join(', ')}.`,
  };
  const options = parseListeningAuditOptions(draft.options);
  if (!options.ok) return options;
  if (!textOf(version)) return { ok: false, error: 'Thiếu version token; tải lại dữ liệu trước khi lưu.' };
  const value = { prompt: String(draft.prompt ?? ''), answer: String(draft.answer ?? ''),
    alternatives: parseListeningAuditList(draft.alternatives), trap_mechanisms: parseListeningAuditList(draft.traps),
    options: options.value, solution: String(draft.solution ?? ''), expected_updated_at: version };
  const startText = String(draft.windowStart ?? '').trim(); const endText = String(draft.windowEnd ?? '').trim();
  if (startText || endText) {
    const start = Number(startText); const end = Number(endText);
    if (!startText || !endText || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return { ok: false, error: 'Audio window cần điền đủ start/end, với start ≥ 0 và end > start.' };
    value.audio_window = { start, end };
  } else if (draft.hadAudioWindow) value.audio_window = null;
  return { ok: true, value };
}

export function questionMatchesListeningAuditPatch(question, patch, previousVersion) {
  return Boolean(question && question.exerciseUpdatedAt && question.exerciseUpdatedAt !== previousVersion
    && question.prompt === patch.prompt && question.answer === patch.answer
    && JSON.stringify(question.alternatives) === JSON.stringify(patch.alternatives)
    && JSON.stringify(question.trapMechanisms) === JSON.stringify(patch.trap_mechanisms)
    && JSON.stringify(question.options) === JSON.stringify(patch.options)
    && question.solution === patch.solution
    && (!Object.hasOwn(patch, 'audio_window') || (patch.audio_window == null
      ? question.audioWindow == null
      : question.audioWindow?.start === patch.audio_window.start && question.audioWindow?.end === patch.audio_window.end)));
}

export function transcriptMatchesListeningAuditPatch(section, transcript, previousVersion) {
  return Boolean(section && section.contentUpdatedAt && section.contentUpdatedAt !== previousVersion && section.transcript === transcript);
}

export function listeningAuditReceiptKey(accountId, testId) {
  return `aver:admin:listening-audit-run:v1:${encodeURIComponent(textOf(accountId))}:${encodeURIComponent(textOf(testId))}`;
}

export function buildListeningAuditReceipt({ accountId, testId, requestId, baselineAuditedAt, now = new Date().toISOString() }) {
  if (!textOf(accountId) || !textOf(testId) || !textOf(requestId) || !textOf(now)) return null;
  return { version: 1, accountId: textOf(accountId), testId: textOf(testId), requestId: textOf(requestId),
    baselineAuditedAt: nullableText(baselineAuditedAt), startedAt: now, acknowledgedAuditedAt: null };
}

export function normalizeListeningAuditReceipt(raw, expected) {
  const value = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  const receipt = objectOf(value);
  if (!receipt || receipt.version !== 1 || textOf(receipt.accountId) !== textOf(expected.accountId)
    || textOf(receipt.testId) !== textOf(expected.testId) || !textOf(receipt.requestId) || !textOf(receipt.startedAt)) return null;
  return { version: 1, accountId: textOf(receipt.accountId), testId: textOf(receipt.testId), requestId: textOf(receipt.requestId),
    baselineAuditedAt: nullableText(receipt.baselineAuditedAt), startedAt: textOf(receipt.startedAt),
    acknowledgedAuditedAt: nullableText(receipt.acknowledgedAuditedAt) };
}

export function listeningAuditReceiptReconciled(receipt, snapshot) {
  const auditedAt = snapshot?.saved?.auditedAt || null;
  const auditedMs = Date.parse(auditedAt || ''); const startedMs = Date.parse(receipt?.startedAt || '');
  // Allow small browser/server clock skew, but never close an ambiguous receipt
  // against a saved audit that demonstrably predates this paid request.
  const afterRequest = Number.isFinite(auditedMs) && Number.isFinite(startedMs)
    && auditedMs >= startedMs - 5 * 60 * 1000;
  const belongsToRequest = receipt?.acknowledgedAuditedAt
    ? auditedAt === receipt.acknowledgedAuditedAt
    : snapshot?.saved?.health?.requestId === receipt?.requestId;
  return Boolean(receipt && auditedAt && afterRequest && auditedAt !== receipt.baselineAuditedAt
    && belongsToRequest);
}
