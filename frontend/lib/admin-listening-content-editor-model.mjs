const ACCENTS = new Set(['us_general', 'uk_rp', 'au', 'ca', 'other']);
const CEFRS = new Set(['A2', 'B1', 'B2', 'C1', 'C2']);
const STATUSES = new Set(['draft', 'published', 'archived']);
const PATCH_KEYS = new Set([
  'title', 'transcript', 'accent_tag', 'cefr_level', 'ielts_section',
  'topic_tags', 'is_premium', 'external_license', 'external_source_url',
  'expected_updated_at',
]);

const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const nullableText = (value) => textOf(value) || null;
const integer = (value) => typeof value === 'number' && Number.isInteger(value) ? value : null;
const sameArray = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
const hasNcRestriction = (value) => /(^|[^A-Z0-9])NC([^A-Z0-9]|$)/.test(String(value || '').toUpperCase());

function normalizeTags(raw) {
  if (!Array.isArray(raw)) return null;
  const tags = [];
  const seen = new Set();
  for (const candidate of raw) {
    if (typeof candidate !== 'string') return null;
    const tag = candidate.trim();
    // Must match backend Python str.lower(); do not use locale-sensitive
    // folding here or a successful canonical readback can look divergent.
    const folded = tag.toLowerCase();
    if (tag && !seen.has(folded)) { seen.add(folded); tags.push(tag); }
  }
  return tags;
}

export function normalizeListeningContentEditor(raw, expectedId) {
  const value = objectOf(raw);
  const id = textOf(value?.id);
  const title = textOf(value?.title);
  const transcript = typeof value?.transcript === 'string' ? value.transcript : null;
  const accent = textOf(value?.accent_tag);
  const cefr = value?.cefr_level == null ? null : textOf(value.cefr_level);
  const section = value?.ielts_section == null ? null : integer(value.ielts_section);
  const tags = normalizeTags(value?.topic_tags);
  const status = textOf(value?.status);
  const updatedAt = textOf(value?.updated_at);
  if (!value || id !== expectedId || !title || title.length > 200
    || transcript == null || !transcript.trim() || transcript.length > 20_000
    || !ACCENTS.has(accent) || (cefr != null && !CEFRS.has(cefr))
    || (section != null && (section < 1 || section > 4)) || !tags
    || typeof value.is_premium !== 'boolean' || !STATUSES.has(status) || !updatedAt
    || !Number.isFinite(Date.parse(updatedAt))) return null;
  return {
    id, title, transcript, accent, cefr, ieltsSection: section, topicTags: tags,
    isPremium: value.is_premium, externalLicense: nullableText(value.external_license),
    externalSourceUrl: nullableText(value.external_source_url), status,
    sourceType: nullableText(value.source_type), audioStoragePath: nullableText(value.audio_storage_path),
    updatedAt,
  };
}

export function listeningContentDraft(snapshot) {
  return {
    title: snapshot.title,
    transcript: snapshot.transcript,
    accent: snapshot.accent,
    cefr: snapshot.cefr,
    ieltsSection: snapshot.ieltsSection,
    topicTags: [...snapshot.topicTags],
    isPremium: snapshot.isPremium,
    externalLicense: snapshot.externalLicense || '',
    externalSourceUrl: snapshot.externalSourceUrl || '',
  };
}

export function parseListeningTopicTags(value) {
  return normalizeTags(String(value || '').split(',')) || [];
}

function httpUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch { return false; }
}

export function validateListeningContentDraft(raw) {
  const value = objectOf(raw);
  const errors = {};
  if (!value) return { ok: false, errors: { form: 'Biểu mẫu không hợp lệ.' }, value: null };
  const title = textOf(value.title);
  const transcript = typeof value.transcript === 'string' ? value.transcript : '';
  const accent = textOf(value.accent);
  const cefr = value.cefr == null || value.cefr === '' ? null : textOf(value.cefr);
  const section = value.ieltsSection == null || value.ieltsSection === '' ? null : Number(value.ieltsSection);
  const tags = normalizeTags(value.topicTags);
  const license = nullableText(value.externalLicense);
  const sourceUrl = nullableText(value.externalSourceUrl);
  if (!title) errors.title = 'Tiêu đề không được để trống.';
  else if (title.length > 200) errors.title = 'Tiêu đề tối đa 200 ký tự.';
  if (!transcript.trim()) errors.transcript = 'Transcript không được để trống.';
  else if (transcript.length > 20_000) errors.transcript = 'Transcript tối đa 20.000 ký tự.';
  if (!ACCENTS.has(accent)) errors.accent = 'Accent không thuộc danh mục canonical.';
  if (cefr != null && !CEFRS.has(cefr)) errors.cefr = 'CEFR không hợp lệ.';
  if (section != null && (!Number.isInteger(section) || section < 1 || section > 4)) errors.ieltsSection = 'IELTS section phải từ 1 đến 4.';
  if (!tags) errors.topicTags = 'Topic tags không đúng định dạng.';
  if (sourceUrl && !httpUrl(sourceUrl)) errors.externalSourceUrl = 'Source URL phải dùng http:// hoặc https://.';
  if (license && !sourceUrl) errors.externalSourceUrl = 'Có license thì phải có source URL để attribution.';
  if (value.isPremium === true && license && hasNcRestriction(license)) errors.isPremium = 'Nội dung có điều khoản NC không thể bán ở paid tier.';
  if (typeof value.isPremium !== 'boolean') errors.isPremium = 'Trạng thái premium không hợp lệ.';
  const normalized = { title, transcript, accent, cefr, ieltsSection: section, topicTags: tags || [], isPremium: value.isPremium === true, externalLicense: license, externalSourceUrl: sourceUrl };
  return { ok: Object.keys(errors).length === 0, errors, value: normalized };
}

export function buildListeningContentPatch(baseline, draft) {
  const validation = validateListeningContentDraft(draft);
  if (!validation.ok || !validation.value) return { ...validation, patch: null, changedFields: [] };
  const value = validation.value;
  const patch = {};
  const changedFields = [];
  const set = (key, next, previous) => { if (next !== previous) { patch[key] = next; changedFields.push(key); } };
  set('title', value.title, baseline.title);
  set('transcript', value.transcript, baseline.transcript);
  set('accent_tag', value.accent, baseline.accent);
  set('cefr_level', value.cefr, baseline.cefr);
  set('ielts_section', value.ieltsSection, baseline.ieltsSection);
  if (!sameArray(value.topicTags, baseline.topicTags)) { patch.topic_tags = value.topicTags; changedFields.push('topic_tags'); }
  set('is_premium', value.isPremium, baseline.isPremium);
  set('external_license', value.externalLicense, baseline.externalLicense);
  set('external_source_url', value.externalSourceUrl, baseline.externalSourceUrl);
  if (changedFields.length) patch.expected_updated_at = baseline.updatedAt;
  return { ok: true, errors: {}, value, patch, changedFields };
}

export function listeningContentPatchMatches(snapshot, patch) {
  const value = objectOf(patch);
  if (!snapshot || !value || Object.keys(value).some((key) => !PATCH_KEYS.has(key))) return false;
  const checks = {
    title: snapshot.title,
    transcript: snapshot.transcript,
    accent_tag: snapshot.accent,
    cefr_level: snapshot.cefr,
    ielts_section: snapshot.ieltsSection,
    is_premium: snapshot.isPremium,
    external_license: snapshot.externalLicense,
    external_source_url: snapshot.externalSourceUrl,
  };
  for (const [key, expected] of Object.entries(value)) {
    if (key === 'expected_updated_at') continue;
    if (key === 'topic_tags') {
      if (!Array.isArray(expected) || !sameArray(snapshot.topicTags, expected)) return false;
    } else if (checks[key] !== expected) return false;
  }
  return true;
}

export function normalizePendingListeningContentEdit(raw, account, contentId) {
  const value = objectOf(raw);
  const patch = objectOf(value?.patch);
  if (!value || textOf(value.account) !== account || textOf(value.contentId) !== contentId
    || !textOf(value.startedAt) || !Number.isFinite(Date.parse(value.startedAt))
    || !patch || !textOf(patch.expected_updated_at)
    || Object.keys(patch).some((key) => !PATCH_KEYS.has(key))) return null;
  return { account, contentId, startedAt: value.startedAt, patch };
}

export const listeningContentEditorHref = (contentId) => `/admin/listening/content/${encodeURIComponent(contentId)}/edit`;
export const listeningContentDetailHref = (contentId) => `/admin/listening/content/${encodeURIComponent(contentId)}`;
export const listeningContentEditorRollbackHref = (contentId) => `/pages/admin/listening/content-meta.html?id=${encodeURIComponent(contentId)}`;
