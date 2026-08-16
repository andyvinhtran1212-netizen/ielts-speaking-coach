import {
  MIX_CRITERIA,
  assembleComposed,
  overallFromPicks,
} from '../public/js/instructor-compose-util.js';

export { MIX_CRITERIA, overallFromPicks };

export const INSTRUCTOR_CRITERION_LABELS = Object.freeze({
  mainCriterion: 'Task Response / Achievement',
  coherenceCohesion: 'Coherence & Cohesion',
  lexicalResource: 'Lexical Resource',
  grammaticalRange: 'Grammatical Range',
});

function objectRow(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value) {
  return text(value) || null;
}

function finite(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function versionNumber(value) {
  const parsed = finite(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function bandNumber(value) {
  const parsed = finite(value);
  return parsed != null && parsed >= 0 && parsed <= 9 ? parsed : null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeVersion(value) {
  const row = objectRow(value);
  const version = versionNumber(row?.version);
  const feedbackJson = objectRow(row?.feedback_json);
  const criteria = objectRow(feedbackJson?.criteriaFeedback);
  if (!row || version == null || !feedbackJson || !criteria) return null;

  for (const key of MIX_CRITERIA) {
    const criterion = objectRow(criteria[key]);
    if (!criterion || bandNumber(criterion.bandScore) == null) return null;
  }

  const overall = row.overall_band_score == null ? null : bandNumber(row.overall_band_score);
  if (row.overall_band_score != null && overall == null) return null;

  return Object.freeze({
    version,
    source: nullableText(row.source),
    overallBandScore: overall,
    createdAt: nullableText(row.created_at),
    feedbackJson: cloneJson(feedbackJson),
  });
}

export function normalizeInstructorVersions(value) {
  const envelope = objectRow(value);
  const budget = objectRow(envelope?.budget);
  if (!envelope || !Array.isArray(envelope.versions) || !budget) return null;

  const versions = [];
  let previous = Number.POSITIVE_INFINITY;
  for (const item of envelope.versions) {
    const normalized = normalizeVersion(item);
    if (!normalized || normalized.version >= previous) return null;
    previous = normalized.version;
    versions.push(normalized);
  }

  const liveCount = versionNumber(budget.live_count === 0 ? null : budget.live_count);
  const max = versionNumber(budget.max);
  if (typeof budget.can_compose !== 'boolean'
      || max == null
      || (versions.length === 0 ? budget.live_count !== 0 : liveCount !== versions.length)
      || versions.length > max) return null;

  return Object.freeze({
    versions: Object.freeze(versions),
    budget: Object.freeze({
      liveCount: versions.length,
      max,
      canCompose: budget.can_compose,
    }),
  });
}

export function defaultInstructorPicks(snapshot) {
  const current = snapshot?.versions?.[0]?.version;
  if (!versionNumber(current)) return null;
  return Object.freeze(Object.fromEntries(MIX_CRITERIA.map((key) => [key, current])));
}

export function assembleInstructorPreview(snapshot, baseVersion, picks) {
  if (!snapshot?.versions?.length || versionNumber(baseVersion) == null) {
    throw new TypeError('instructor-compare-selection-required');
  }
  const normalizedPicks = {};
  for (const key of MIX_CRITERIA) {
    const picked = versionNumber(picks?.[key]);
    if (picked == null) throw new TypeError('instructor-compare-selection-required');
    normalizedPicks[key] = picked;
  }
  const byVersion = Object.fromEntries(snapshot.versions.map((item) => [item.version, item.feedbackJson]));
  return assembleComposed(byVersion, versionNumber(baseVersion), normalizedPicks);
}

export function instructorVersionLabel(version) {
  const source = version?.source;
  const tag = source === 'composed'
    ? 'Bản ghép'
    : source?.startsWith('ai_')
      ? 'AI'
      : source || 'Không rõ nguồn';
  return `v${version?.version} · ${tag}`;
}

/**
 * @param {unknown} essayId
 * @param {string | null} [asInstructor]
 */
export function instructorCompareBackHref(essayId, asInstructor = null) {
  const id = text(essayId);
  if (!id) throw new TypeError('essay-id-required');
  const params = new URLSearchParams({ essay_id: id });
  const target = nullableText(asInstructor);
  if (target) params.set('as_instructor', target);
  return `/pages/instructor/grade.html?${params.toString()}`;
}

export function instructorComposePayload(baseVersion, picks) {
  const base = versionNumber(baseVersion);
  if (base == null) throw new TypeError('instructor-compare-selection-required');
  const body = { base_version: base };
  for (const key of MIX_CRITERIA) {
    const picked = versionNumber(picks?.[key]);
    if (picked == null) throw new TypeError('instructor-compare-selection-required');
    body[key] = picked;
  }
  return body;
}
