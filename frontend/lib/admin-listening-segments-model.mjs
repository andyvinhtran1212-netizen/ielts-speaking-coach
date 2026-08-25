const STATUSES = new Set(['draft', 'published', 'archived']);
export const MAX_LISTENING_SEGMENTS = 500;

const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const integer = (value) => typeof value === 'number' && Number.isInteger(value) ? value : null;
const round3 = (value) => Math.round(value * 1000) / 1000;

function safeHttpUrl(value) {
  const raw = textOf(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname ? raw : null;
  } catch { return null; }
}

function normalizeAlignment(raw) {
  const value = objectOf(raw);
  if (!value) return null;
  const characters = value.characters;
  const starts = value.character_start_times_seconds;
  const ends = value.character_end_times_seconds;
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends)
    || !characters.length || characters.length > 200_000
    || characters.length !== starts.length || characters.length !== ends.length) return null;
  let codeUnitCount = 0;
  if (characters.some((item) => {
    if (typeof item !== 'string' || !item.length) return true;
    codeUnitCount += item.length;
    return codeUnitCount > 200_000;
  })
    || starts.some((item) => typeof item !== 'number' || !Number.isFinite(item) || item < 0)
    || ends.some((item, index) => typeof item !== 'number' || !Number.isFinite(item) || item < starts[index])) return null;
  return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
}

export function normalizeListeningSegmentContent(raw, expectedId) {
  const value = objectOf(raw);
  const id = textOf(value?.id);
  const title = textOf(value?.title);
  const transcript = typeof value?.transcript === 'string' ? value.transcript : '';
  const durationSeconds = finite(value?.audio_duration_seconds);
  const status = textOf(value?.status);
  if (!value || id !== expectedId || !title
    || durationSeconds == null || durationSeconds <= 0 || !STATUSES.has(status)) return null;
  return {
    id, title, transcript, durationSeconds, status,
    audioUrl: safeHttpUrl(value.audio_signed_url),
    sourceType: textOf(value.source_type) || null,
    alignment: normalizeAlignment(value.alignment_data),
  };
}

function normalizeSegment(raw, expectedIndex) {
  const value = objectOf(raw);
  const idx = integer(value?.idx);
  const transcript = typeof value?.transcript === 'string' ? value.transcript : '';
  const startSec = finite(value?.start_sec);
  const endSec = finite(value?.end_sec);
  if (!value || idx !== expectedIndex || !transcript.trim() || startSec == null || endSec == null
    || startSec < 0 || endSec <= startSec) return null;
  return { idx, transcript, startSec, endSec };
}

function normalizeBlock(raw, expectedContentId) {
  const value = objectOf(raw);
  const id = textOf(value?.id);
  const contentId = textOf(value?.content_id);
  const orderNum = integer(value?.order_num);
  const status = textOf(value?.status);
  const updatedAt = textOf(value?.updated_at);
  const rawSegments = value?.segments == null ? [] : value.segments;
  if (!value || !id || contentId !== expectedContentId || value.exercise_type !== 'dictation'
    || orderNum == null || orderNum < 1 || orderNum > 200 || !STATUSES.has(status)
    || !updatedAt || !Number.isFinite(Date.parse(updatedAt)) || !Array.isArray(rawSegments)
    || rawSegments.length > MAX_LISTENING_SEGMENTS) return null;
  const segments = [];
  for (let index = 0; index < rawSegments.length; index += 1) {
    const segment = normalizeSegment(rawSegments[index], index);
    if (!segment) return null;
    segments.push(segment);
  }
  return { id, contentId, orderNum, status, updatedAt, segments };
}

export function normalizeListeningDictationBlocks(raw, expectedContentId) {
  const value = objectOf(raw);
  if (!value || !Array.isArray(value.exercises)) return null;
  const items = [];
  let malformedCount = 0;
  for (const candidate of value.exercises) {
    const block = normalizeBlock(candidate, expectedContentId);
    if (block) items.push(block); else malformedCount += 1;
  }
  items.sort((left, right) => left.orderNum - right.orderNum || left.id.localeCompare(right.id));
  const seenOrders = new Set();
  const duplicateOrders = [];
  for (const item of items) {
    if (seenOrders.has(item.orderNum)) duplicateOrders.push(item.orderNum);
    seenOrders.add(item.orderNum);
  }
  return { items, malformedCount, duplicateOrders: [...new Set(duplicateOrders)] };
}

export function listeningSegmentDraft(block) {
  return block ? block.segments.map((item) => ({ transcript: item.transcript, startSec: item.startSec, endSec: item.endSec })) : [];
}

export function splitListeningTranscript(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const sentences = [];
  for (const line of raw.split('\n').map((part) => part.trim()).filter(Boolean)) {
    const parts = line.replace(/([.!?])\s+(?=[A-Z"'\u201C\u2018])/g, '$1\u0000')
      .split('\u0000').map((part) => part.trim()).filter(Boolean);
    sentences.push(...parts);
  }
  return sentences;
}

function collapsedWithOffsets(raw) {
  let text = '';
  const offsets = [];
  let inWhitespace = false;
  for (let index = 0; index < raw.length; index += 1) {
    if (/\s/.test(raw[index])) {
      if (!inWhitespace) { text += ' '; offsets.push(index); }
      inWhitespace = true;
    } else {
      text += raw[index]; offsets.push(index); inWhitespace = false;
    }
  }
  return { text, offsets };
}

export function assignListeningAlignmentTimestamps(sentences, alignment) {
  if (!Array.isArray(sentences) || !sentences.length || !alignment) return null;
  const normalized = normalizeAlignment(alignment);
  if (!normalized) return null;
  const rebuilt = normalized.characters.join('');
  const rawIndexToAlignmentIndex = [];
  normalized.characters.forEach((token, tokenIndex) => {
    for (let offset = 0; offset < token.length; offset += 1) rawIndexToAlignmentIndex.push(tokenIndex);
  });
  const collapsed = collapsedWithOffsets(rebuilt);
  const out = [];
  let cursor = 0;
  for (const sentence of sentences) {
    const needle = collapsedWithOffsets(String(sentence).trim()).text.trim();
    if (!needle) return null;
    const found = collapsed.text.indexOf(needle, cursor);
    if (found < 0) return null;
    const rawStartIndex = collapsed.offsets[found];
    const rawEndIndex = collapsed.offsets[found + needle.length - 1];
    const startIndex = rawIndexToAlignmentIndex[rawStartIndex];
    const endIndex = rawIndexToAlignmentIndex[rawEndIndex];
    if (startIndex == null || endIndex == null || endIndex >= normalized.character_end_times_seconds.length) return null;
    out.push({
      transcript: String(sentence).trim(),
      startSec: round3(normalized.character_start_times_seconds[startIndex]),
      endSec: round3(normalized.character_end_times_seconds[endIndex]),
    });
    cursor = found + needle.length;
  }
  for (let index = 0; index < out.length - 1; index += 1) {
    if (out[index].endSec < out[index + 1].startSec) out[index].endSec = out[index + 1].startSec;
  }
  return out;
}

export function assignListeningProportionalTimestamps(sentences, durationSeconds) {
  if (!Array.isArray(sentences) || !sentences.length) return [];
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    return sentences.map((transcript) => ({ transcript, startSec: null, endSec: null }));
  }
  const totalCharacters = sentences.reduce((total, sentence) => total + sentence.length, 0) || 1;
  let cursor = 0;
  return sentences.map((transcript, index) => {
    const startSec = cursor;
    const endSec = index === sentences.length - 1 ? duration : cursor + duration * (transcript.length / totalCharacters);
    cursor = endSec;
    return { transcript, startSec: round3(startSec), endSec: round3(endSec) };
  });
}

export function formatListeningSegmentTime(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const rounded = round3(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = round3(rounded - minutes * 60);
  const display = remainder.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0');
  return `${minutes}:${remainder < 10 ? `0${display}` : display}`;
}

export function parseListeningSegmentTime(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length > 2) return null;
  const seconds = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
  return Number.isFinite(seconds) && seconds >= 0 ? round3(seconds) : null;
}

export function validateListeningSegments(raw, durationSeconds) {
  const errors = {};
  if (!Array.isArray(raw) || !raw.length) return { ok: false, errors: { form: 'Cần ít nhất một câu.' }, segments: [] };
  if (raw.length > MAX_LISTENING_SEGMENTS) return { ok: false, errors: { form: `Tối đa ${MAX_LISTENING_SEGMENTS} câu.` }, segments: [] };
  const duration = Number(durationSeconds);
  let previousEnd = -1;
  const segments = raw.map((candidate, index) => {
    const value = objectOf(candidate) || {};
    const transcript = typeof value.transcript === 'string' ? value.transcript.trim() : '';
    const startSec = finite(value.startSec);
    const endSec = finite(value.endSec);
    const rowErrors = [];
    if (!transcript) rowErrors.push('Thiếu transcript');
    if (startSec == null || startSec < 0) rowErrors.push('Start không hợp lệ');
    if (endSec == null || (startSec != null && endSec <= startSec)) rowErrors.push('End phải lớn hơn start');
    if (endSec != null && Number.isFinite(duration) && endSec > duration + 0.5) rowErrors.push('End vượt thời lượng audio');
    if (startSec != null && startSec < previousEnd - 0.05) rowErrors.push('Chồng lấn câu trước');
    if (rowErrors.length) errors[index] = rowErrors.join(' · ');
    if (endSec != null) previousEnd = endSec;
    return { idx: index, transcript, start_sec: startSec, end_sec: endSec };
  });
  return { ok: Object.keys(errors).length === 0, errors, segments };
}

export function buildListeningSegmentOperation({ contentId, block, orderNum, draft, durationSeconds, status }) {
  const validation = validateListeningSegments(draft, durationSeconds);
  if (!validation.ok || !STATUSES.has(status)) return { ok: false, errors: validation.errors, operation: null };
  const operation = {
    content_id: contentId,
    exercise_type: 'dictation',
    order_num: orderNum,
    segments: validation.segments,
    status,
  };
  if (block) {
    operation.exercise_id = block.id;
    operation.expected_updated_at = block.updatedAt;
  } else operation.expected_absent = true;
  return { ok: true, errors: {}, operation };
}

function sameSegments(block, expected) {
  return block.segments.length === expected.length && block.segments.every((segment, index) => {
    const other = expected[index];
    return segment.idx === other.idx && segment.transcript === other.transcript
      && Math.abs(segment.startSec - other.start_sec) < 0.0005
      && Math.abs(segment.endSec - other.end_sec) < 0.0005;
  });
}

export function findListeningSegmentOperationMatch(collection, operation) {
  if (!collection || !operation || !Array.isArray(operation.segments)) return null;
  const block = operation.exercise_id
    ? collection.items.find((item) => item.id === operation.exercise_id)
    : collection.items.find((item) => item.orderNum === operation.order_num);
  if (!block || block.contentId !== operation.content_id || block.status !== operation.status
    || block.orderNum !== operation.order_num || !sameSegments(block, operation.segments)) return null;
  return block;
}

export function normalizePendingListeningSegmentSave(raw, account, contentId) {
  const value = objectOf(raw);
  const operation = objectOf(value?.operation);
  if (!value || textOf(value.account) !== account || textOf(value.contentId) !== contentId
    || !textOf(value.startedAt) || !Number.isFinite(Date.parse(value.startedAt))
    || !operation || operation.content_id !== contentId || operation.exercise_type !== 'dictation'
    || !integer(operation.order_num) || !Array.isArray(operation.segments)
    || !(textOf(operation.expected_updated_at) || operation.expected_absent === true)) return null;
  return { account, contentId, startedAt: value.startedAt, operation };
}

/** @param {string} contentId @param {string|null} [exerciseId] */
export const listeningSegmentsHref = (contentId, exerciseId = null) => {
  const query = new URLSearchParams({ content_id: contentId });
  if (exerciseId) query.set('exercise_id', exerciseId);
  return `/admin/listening/segments?${query}`;
};
export const listeningSegmentsRollbackHref = (contentId) => `/pages/admin/listening/segments.html?content_id=${encodeURIComponent(contentId)}`;
