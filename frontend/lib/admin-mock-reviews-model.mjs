const TEXT = (value) => typeof value === 'string' ? value.trim() : '';
const SKILLS = Object.freeze(['listening', 'reading', 'writing', 'speaking']);
const REVIEW_STATUSES = new Set(['queued', 'claimed', 'edited', 'reviewed', 'released']);
const ESSAY_STATUSES = new Set(['pending', 'grading', 'graded', 'reviewed', 'delivered', 'failed']);

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function band(value) {
  const parsed = finite(value);
  return parsed != null && parsed >= 0 && parsed <= 9 ? parsed : null;
}

function nullableId(value) {
  if (value == null) return null;
  return TEXT(value) || null;
}

function displayText(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) return value.map(String).join(', ');
  return '';
}

function skillFlags(raw) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const result = {};
  for (const skill of SKILLS) if (raw[skill] === true) result[skill] = true;
  return result;
}

function lrSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const score = raw.score == null ? null : count(raw.score);
  const max = raw.max == null ? null : count(raw.max);
  const estimate = raw.band == null ? null : band(raw.band);
  if ((raw.score != null && score == null) || (raw.max != null && max == null) || (raw.band != null && estimate == null)) return null;
  return { score, max, band: estimate };
}

function writingSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const task1Wc = raw.task1_wc == null ? null : count(raw.task1_wc);
  const task2Wc = raw.task2_wc == null ? null : count(raw.task2_wc);
  const estimate = raw.band == null ? null : band(raw.band);
  if ((raw.task1_wc != null && task1Wc == null) || (raw.task2_wc != null && task2Wc == null) || (raw.band != null && estimate == null)) return null;
  return {
    task1Wc,
    task2Wc,
    task1EssayId: nullableId(raw.task1_essay_id),
    task2EssayId: nullableId(raw.task2_essay_id),
    band: estimate,
    bandIsFinal: raw.band_is_final === true,
  };
}

function speakingSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sessions = count(raw.count);
  const estimate = raw.band == null ? null : band(raw.band);
  if (sessions == null || (raw.band != null && estimate == null)) return null;
  return { count: sessions, band: estimate, bandIsFinal: raw.band_is_final === true };
}

export function normalizeReviewRoster(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.roster)) return null;
  const rows = [];
  const seen = new Set();
  let malformedCount = 0;
  for (const item of raw.roster) {
    if (!item || typeof item !== 'object') { malformedCount += 1; continue; }
    const sittingId = TEXT(item.sitting_id);
    const reviewId = nullableId(item.review_id);
    const reviewStatus = item.review_status == null ? null : TEXT(item.review_status);
    const listening = lrSnapshot(item.listening);
    const reading = lrSnapshot(item.reading);
    const writing = writingSnapshot(item.writing);
    const speaking = speakingSnapshot(item.speaking);
    const flags = skillFlags(item.retest_flags);
    if (!sittingId || seen.has(sittingId) || (reviewStatus && !REVIEW_STATUSES.has(reviewStatus)) || !listening || !reading || !writing || !speaking || !flags) {
      malformedCount += 1; continue;
    }
    seen.add(sittingId);
    rows.push({
      sittingId,
      reviewId,
      studentName: TEXT(item.student_name) || '—',
      sittingStatus: TEXT(item.sitting_status),
      listening,
      reading,
      writing,
      speaking,
      reviewStatus,
      claimed: item.claimed === true,
      needsRetest: item.needs_retest === true,
      retestFlags: flags,
    });
  }
  return { rows, malformedCount };
}

export function normalizeRetestSummary(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.students) || typeof raw.per_skill !== 'object') return null;
  const totalSittings = count(raw.total_sittings);
  const reviewedSittings = count(raw.reviewed_sittings);
  const needsRetestCount = count(raw.needs_retest_count);
  const perSkill = {};
  if (totalSittings == null || reviewedSittings == null || needsRetestCount == null) return null;
  for (const skill of SKILLS) {
    const value = count(raw.per_skill[skill]);
    if (value == null) return null;
    perSkill[skill] = value;
  }
  const students = [];
  const seen = new Set();
  for (const item of raw.students) {
    if (!item || typeof item !== 'object') return null;
    const sittingId = TEXT(item.sitting_id);
    if (!sittingId || seen.has(sittingId) || !Array.isArray(item.skills)) return null;
    const skills = item.skills.map(TEXT);
    if (skills.some((skill) => !SKILLS.includes(skill)) || new Set(skills).size !== skills.length) return null;
    seen.add(sittingId);
    students.push({ sittingId, userId: nullableId(item.user_id), studentName: TEXT(item.student_name) || '—', skills });
  }
  return { totalSittings, reviewedSittings, needsRetestCount, perSkill, students };
}

function normalizeBandMap(raw) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const result = {};
  for (const key of [...SKILLS, 'overall']) {
    if (raw[key] == null) continue;
    const value = band(raw[key]);
    if (value == null) return null;
    result[key] = value;
  }
  return result;
}

function normalizeReview(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = TEXT(raw.id);
  const sittingId = TEXT(raw.sitting_id);
  const status = TEXT(raw.status);
  const finalBands = normalizeBandMap(raw.final_bands);
  const flags = skillFlags(raw.retest_flags);
  if (!id || !sittingId || !REVIEW_STATUSES.has(status) || !finalBands || !flags) return null;
  return {
    id,
    sittingId,
    status,
    claimedBy: nullableId(raw.claimed_by),
    aiDraft: raw.ai_draft && typeof raw.ai_draft === 'object' && !Array.isArray(raw.ai_draft) ? raw.ai_draft : {},
    finalBands,
    perSkillNotes: raw.per_skill_notes && typeof raw.per_skill_notes === 'object' && !Array.isArray(raw.per_skill_notes) ? raw.per_skill_notes : {},
    retestFlags: flags,
    examinerComment: TEXT(raw.examiner_comment_vi),
  };
}

function normalizeSitting(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = TEXT(raw.id);
  if (!id) return null;
  const writing = {};
  if (raw.writing_submission != null) {
    if (typeof raw.writing_submission !== 'object' || Array.isArray(raw.writing_submission)) return null;
    for (const task of ['task1', 'task2']) {
      const source = raw.writing_submission[task];
      if (source == null) continue;
      if (typeof source !== 'object' || Array.isArray(source)) return null;
      const wordCount = source.word_count == null ? null : count(source.word_count);
      if (source.word_count != null && wordCount == null) return null;
      writing[task] = { text: TEXT(source.text), word_count: wordCount };
    }
  }
  if (raw.speaking_session_ids != null && !Array.isArray(raw.speaking_session_ids)) return null;
  const speakingSessionIds = (raw.speaking_session_ids || []).map(TEXT);
  if (speakingSessionIds.some((id) => !id) || new Set(speakingSessionIds).size !== speakingSessionIds.length) return null;
  return {
    id,
    studentName: TEXT(raw.student_name) || '—',
    status: TEXT(raw.status),
    listeningAttemptId: nullableId(raw.listening_attempt_id),
    readingAttemptId: nullableId(raw.reading_attempt_id),
    essayTask1Id: nullableId(raw.essay_task1_id),
    essayTask2Id: nullableId(raw.essay_task2_id),
    speakingSessionIds,
    writingSubmission: writing,
  };
}

export function normalizeReviewDetail(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.required_skills) || !Array.isArray(raw.blankable_skills)) return null;
  const review = normalizeReview(raw.review);
  const sitting = normalizeSitting(raw.sitting);
  const requiredSkills = raw.required_skills.map(TEXT);
  const blankableSkills = raw.blankable_skills.map(TEXT);
  if (!review || !sitting || review.sittingId !== sitting.id || !requiredSkills.length || requiredSkills.some((skill) => !SKILLS.includes(skill)) || new Set(requiredSkills).size !== requiredSkills.length || blankableSkills.some((skill) => !requiredSkills.includes(skill)) || new Set(blankableSkills).size !== blankableSkills.length) return null;
  return { review, sitting, requiredSkills, blankableSkills };
}

export function draftBandOf(draft, skill) {
  const value = draft?.[skill];
  if (typeof value === 'number') return band(value);
  if (!value || typeof value !== 'object') return null;
  return band(value.band);
}

export function reviewBandSkills(detail) {
  if (!detail) return [];
  const skills = [...detail.requiredSkills];
  const liveSpeaking = detail.review.aiDraft?.speaking != null || detail.review.perSkillNotes?.speaking != null;
  if (liveSpeaking && !skills.includes('speaking')) skills.push('speaking');
  return skills;
}

export function initialBandDraft(detail) {
  const result = {};
  for (const skill of reviewBandSkills(detail)) {
    const value = detail.review.finalBands[skill] ?? draftBandOf(detail.review.aiDraft, skill);
    result[skill] = value == null ? '' : String(value);
  }
  return result;
}

export function buildFinalBandsPayload(detail, draft, flags, comment) {
  if (!detail) return { ok: false, error: 'Chưa có hồ sơ canonical.' };
  const finalBands = {};
  for (const skill of reviewBandSkills(detail)) {
    const text = TEXT(draft?.[skill]);
    if (!text) {
      if (!detail.blankableSkills.includes(skill)) return { ok: false, error: `Còn thiếu band ${skill}.` };
      continue;
    }
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0 || value > 9 || Math.abs(value * 2 - Math.round(value * 2)) > 1e-9) return { ok: false, error: `Band ${skill} phải từ 0–9 theo bước 0.5.` };
    finalBands[skill] = value;
  }
  const retestFlags = {};
  for (const skill of detail.requiredSkills) retestFlags[skill] = flags?.[skill] === true;
  return { ok: true, value: { final_bands: finalBands, examiner_comment_vi: TEXT(comment) || null, retest_flags: retestFlags } };
}

export function overallPreview(detail, draft) {
  const values = [];
  for (const skill of reviewBandSkills(detail)) {
    const text = TEXT(draft?.[skill]);
    if (!text) {
      if (detail.requiredSkills.includes(skill)) return null;
      continue;
    }
    const value = Number(text);
    if (!Number.isFinite(value)) return null;
    values.push(value);
  }
  if (!values.length) return null;
  return Math.max(0, Math.min(9, Math.floor((values.reduce((a, b) => a + b, 0) / values.length) * 2 + 0.5 + 1e-9) / 2));
}

export function normalizeBulkAck(raw, successKey) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw[successKey]) || !Array.isArray(raw.skipped)) return null;
  const successes = raw[successKey].map(TEXT);
  const skipped = raw.skipped.map((row) => row && typeof row === 'object' ? { sittingId: TEXT(row.sitting_id), reason: TEXT(row.reason) } : null);
  if (successes.some((id) => !id) || new Set(successes).size !== successes.length || skipped.some((row) => !row?.sittingId || !row.reason)) return null;
  return { successes, skipped };
}

export function normalizeEssayStatus(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const status = TEXT(raw.status);
  return ESSAY_STATUSES.has(status) ? { status } : null;
}

export function normalizeSkillReview(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.review)) return null;
  const score = count(raw.score);
  const maxScore = count(raw.max_score);
  const bandEstimate = raw.band_estimate == null ? null : band(raw.band_estimate);
  if (score == null || maxScore == null || score > maxScore || (raw.band_estimate != null && bandEstimate == null)) return null;
  const review = [];
  for (const item of raw.review) {
    if (!item || typeof item !== 'object') return null;
    const qNum = count(item.q_num);
    if (qNum == null || typeof item.correct !== 'boolean') return null;
    review.push({ q_num: qNum, user_answer: displayText(item.user_answer), expected: displayText(item.expected), correct: item.correct });
  }
  const normalizeBreakdown = (source, keys) => {
    if (source == null) return {};
    if (typeof source !== 'object' || Array.isArray(source)) return null;
    const result = {};
    for (const [name, value] of Object.entries(source)) {
      if (!TEXT(name) || !value || typeof value !== 'object' || Array.isArray(value)) return null;
      const row = {};
      for (const key of keys) {
        const parsed = count(value[key]);
        if (parsed == null) return null;
        row[key] = parsed;
      }
      result[name] = row;
    }
    return result;
  };
  const skillBreakdown = normalizeBreakdown(raw.skill_breakdown, ['correct', 'total']);
  const trapAnalytics = normalizeBreakdown(raw.trap_analytics, ['caught', 'missed']);
  if (!skillBreakdown || !trapAnalytics) return null;
  return { score, max_score: maxScore, band_estimate: bandEstimate, review, skill_breakdown: skillBreakdown, trap_analytics: trapAnalytics };
}

export function reportSkills(detail) {
  if (!detail) return [];
  return SKILLS.filter((skill) => detail.requiredSkills.includes(skill) || detail.review.finalBands[skill] != null);
}

export const MOCK_REVIEW_SKILLS = SKILLS;
