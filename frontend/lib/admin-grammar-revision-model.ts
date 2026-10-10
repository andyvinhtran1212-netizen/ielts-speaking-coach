import type { components } from '../types/api';

export const GRAMMAR_REVISION_CODES = Object.freeze([
  'G-parts-of-speech-verbs',
  'G-sentence-structures-passive-voice',
  'G-tenses-past-continuous',
  'G-tenses-present-continuous',
  'G-tenses-present-perfect-continuous',
  'G-tenses-present-simple',
  'G-grammar-for-reading-participle-clauses',
  'G-grammar-for-reading-long-sentence-untangling',
  'G-grammar-for-reading-reduced-relative-clauses',
  'G-tenses-past-perfect',
  'G-foundations-phrase-vs-clause',
  'G-error-clinic-dangling-modifiers',
  'G-error-clinic-affect-vs-effect',
  'G-error-clinic-article-errors',
  'G-error-clinic-do-vs-make',
  'G-error-clinic-double-subject-errors',
  'G-error-clinic-economic-vs-economical',
  'G-error-clinic-historic-vs-historical',
  'G-error-clinic-overusing-i-think',
  'G-error-clinic-preposition-errors',
  'G-error-clinic-run-on-sentences',
  'G-error-clinic-say-tell-speak-talk',
  'G-error-clinic-sentence-fragments',
  'G-error-clinic-subject-verb-agreement',
  'G-error-clinic-tense-consistency',
  'G-error-clinic-wrong-pronoun-reference',
  'G-foundations-articles-a-an-sound-rules',
  'G-foundations-countable-vs-uncountable',
  'G-foundations-few-a-few-little-a-little',
  'G-foundations-noun-phrase-basics',
  'G-foundations-parts-of-speech',
  'G-foundations-singular-vs-plural',
  'G-foundations-this-that-these-those-in-use',
  'G-foundations-word-order',
  'G-foundations-zero-article',
  'G-grammar-for-meaning-although-though-even-though',
  'G-grammar-for-meaning-comparison',
  'G-grammar-for-meaning-conditionals',
  'G-grammar-for-meaning-discourse-markers',
  'G-grammar-for-meaning-discourse-markers-spoken',
  'G-grammar-for-meaning-hedging-language',
  'G-grammar-for-meaning-so-vs-such',
  'G-grammar-for-reading-appositives-and-parentheticals',
  'G-grammar-for-reading-comparison-structures-in-reading',
  'G-grammar-for-reading-complex-noun-phrases',
  'G-grammar-for-reading-ellipsis-and-substitution',
  'G-grammar-for-reading-hedging-and-certainty-in-reading',
  'G-grammar-for-reading-logical-connectors-in-reading',
  'G-grammar-for-reading-nominalization',
  'G-grammar-for-reading-paraphrase-patterns',
  'G-grammar-for-reading-punctuation-as-meaning-signals',
  'G-grammar-for-reading-reference-and-cohesion',
  'G-grammar-for-writing-cohesion-devices-in-writing',
  'G-grammar-for-writing-complex-sentences-for-task2',
  'G-grammar-for-writing-grammar-in-task1',
  'G-grammar-for-writing-parallel-structure',
  'G-grammar-for-writing-punctuation-for-writing',
  'G-grammar-for-writing-relative-clauses-in-writing',
  'G-grammar-for-writing-task1-trend-grammar',
  'G-ielts-grammar-lab-adding-contrast-naturally',
  'G-ielts-grammar-lab-adding-reasons-clearly',
  'G-ielts-grammar-lab-agreeing-and-disagreeing-naturally',
  'G-ielts-grammar-lab-avoiding-repetitive-sentence-openings',
  'G-ielts-grammar-lab-balanced-arguments-grammar',
  'G-ielts-grammar-lab-comparing-ideas-in-speaking',
  'G-ielts-grammar-lab-conditionals-in-speaking',
  'G-ielts-grammar-lab-giving-examples-naturally',
  'G-ielts-grammar-lab-grammar-for-band7plus',
  'G-ielts-grammar-lab-grammar-in-speaking',
  'G-ielts-grammar-lab-speculating-about-the-future',
  'G-ielts-grammar-lab-strong-vs-cautious-opinions',
  'G-ielts-grammar-lab-talking-about-future-plans',
  'G-ielts-grammar-lab-talking-about-habits-and-routines',
  'G-modifiers-adverbs',
  'G-modifiers-compound-adjectives',
  'G-modifiers-intensifiers-and-mitigators',
  'G-modifiers-order-of-adjectives',
  'G-parts-of-speech-conjunctions',
  'G-parts-of-speech-nouns',
  'G-parts-of-speech-prepositions',
  'G-parts-of-speech-word-formation-adjective-suffixes',
  'G-parts-of-speech-word-formation-noun-suffixes',
  'G-sentence-structures-complex-sentence',
  'G-sentence-structures-inversion',
  'G-sentence-structures-reported-speech',
  'G-tenses-future-forms',
  'G-tenses-present-perfect',
  'G-verb-patterns-gerund-vs-infinitive',
  'G-verb-patterns-infinitive',
  'G-verb-patterns-phrasal-verbs',
] as const);
export type RevisionCode = typeof GRAMMAR_REVISION_CODES[number];
export type RevisionRead = components['schemas']['GrammarRevisionRead'];
export type RevisionPreview = components['schemas']['GrammarRevisionPreview'];
export type RevisionAck = components['schemas']['GrammarRevisionCommitResult'];
export type CommitBody = components['schemas']['GrammarRevisionCommitRequest'];
export type FrozenRevisionCommand = Readonly<{
  actor: string; code: RevisionCode; body: Readonly<CommitBody>;
  sourceHash: string; proposedRevision: string; originalBankId: string; rootBankId: string; topicId: string;
  originalQuestionsHash: string; originalMetadataHash: string;
}>;
export const MAX_GRAMMAR_SOURCE_BYTES = 256 * 1024;
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every((n) => Object.hasOwn(v, n));
const count = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
export function isGrammarRevisionCode(value: unknown): value is RevisionCode {
  return typeof value === 'string' && (GRAMMAR_REVISION_CODES as readonly string[]).includes(value);
}

/** UTF-8 identity, never trimmed/normalized; TextEncoder alone replaces invalid surrogates. */
export function sourceBytes(source: unknown): number | null {
  if (typeof source !== 'string' || !source.length) return null;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = source.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null;
    } else if (c >= 0xdc00 && c <= 0xdfff) return null;
  }
  const size = new TextEncoder().encode(source).length;
  return size <= MAX_GRAMMAR_SOURCE_BYTES ? size : null;
}
export function commandFits(body: unknown): boolean {
  try { return new TextEncoder().encode(JSON.stringify(body)).length <= MAX_GRAMMAR_SOURCE_BYTES; }
  catch { return false; }
}
export async function grammarSourceHash(source: string): Promise<string> {
  if (sourceBytes(source) === null) throw new Error('Nguồn phải là UTF-8 hợp lệ, từ 1 đến 256KiB.');
  const result = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function normalizeRevisionRead(value: unknown, code: RevisionCode): RevisionRead | null {
  if (!record(value) || !keys(value, ['canonical_code', 'original_bank_id', 'canonical_root_bank_id', 'bank_ids', 'publication_available', 'current_bank_id', 'topic_id', 'revision', 'current_bank_revision', 'original_questions_sha256', 'original_metadata_sha256', 'is_managed', 'new_starts_enabled', 'footprint'])
      || value.canonical_code !== code || !isGrammarRevisionCode(code)
      || !['original_bank_id', 'canonical_root_bank_id', 'current_bank_id', 'topic_id'].every((key) => uuid(value[key]))
      || !['revision', 'current_bank_revision', 'original_questions_sha256', 'original_metadata_sha256'].every((key) => sha(value[key]))
      || typeof value.is_managed !== 'boolean' || typeof value.new_starts_enabled !== 'boolean'
      || typeof value.publication_available !== 'boolean'
      || !Array.isArray(value.bank_ids) || value.bank_ids.length < 1 || value.bank_ids.length > 3
      || !value.bank_ids.every(uuid) || new Set(value.bank_ids).size !== value.bank_ids.length
      || value.bank_ids[0] !== value.canonical_root_bank_id || value.bank_ids.at(-1) !== value.current_bank_id
      || !value.bank_ids.some(id => id === value.original_bank_id)
      || (value.is_managed ? value.bank_ids.length < 2 : value.bank_ids.length !== 1)
      || (value.publication_available && value.is_managed && (code !== 'G-grammar-for-reading-long-sentence-untangling'
        || value.bank_ids.length !== 2 || value.original_bank_id !== value.current_bank_id))
      || (!value.is_managed && (!value.publication_available || value.original_bank_id !== value.current_bank_id))
      || (value.bank_ids.length === 3 && (code !== 'G-grammar-for-reading-long-sentence-untangling'
        || value.publication_available || value.original_bank_id !== value.bank_ids[1]))) return null;
  const f = value.footprint;
  if (!record(f) || !keys(f, ['actors', 'sessions', 'stats', 'attempts', 'assignments', 'open_sessions', 'paused_sessions', 'classifications', 'authoritative_review_required'])
      || !count(f.actors, 128) || !count(f.sessions, 2048) || !count(f.stats, 8192) || !count(f.attempts, 32768)
      || !count(f.assignments) || !count(f.open_sessions, f.sessions) || !count(f.paused_sessions, f.sessions)
      || f.open_sessions + f.paused_sessions > f.sessions || typeof f.authoritative_review_required !== 'boolean'
      || !record(f.classifications)) return null;
  let total = 0;
  for (const [name, n] of Object.entries(f.classifications)) {
    if (!name.length || !count(n, 128)) return null;
    if (name.startsWith('unknown_') && n > 0 && !f.authoritative_review_required) return null;
    total += n;
  }
  if (total !== f.actors) return null;
  return { ...value, footprint: { ...f, classifications: { ...f.classifications } } } as RevisionRead;
}
const REVIEWED_INPUT_QIDS: Partial<Record<RevisionCode, readonly string[]>> = {"G-error-clinic-subject-verb-agreement": ["sva_coll_b1"], "G-error-clinic-tense-consistency": ["tc_pastnar_a1"], "G-grammar-for-reading-ellipsis-and-substitution": ["sub_ds_i1"], "G-ielts-grammar-lab-avoiding-repetitive-sentence-openings": ["arso_front_b1"], "G-ielts-grammar-lab-balanced-arguments-grammar": ["bag_hand_b1"], "G-modifiers-intensifiers-and-mitigators": ["im_rather_b1", "im_rather_i1"], "G-tenses-present-perfect": ["pp_vs_b1"]};
const sameScope = (a: RevisionRead, b: RevisionRead) => ['canonical_code', 'original_bank_id', 'canonical_root_bank_id', 'bank_ids', 'publication_available', 'current_bank_id', 'topic_id', 'revision', 'current_bank_revision', 'original_questions_sha256', 'original_metadata_sha256', 'is_managed', 'new_starts_enabled'].every((k) => JSON.stringify(a[k as keyof RevisionRead]) === JSON.stringify(b[k as keyof RevisionRead]));
export function normalizeRevisionPreview(value: unknown, canonical: RevisionRead, sourceHash: string): RevisionPreview | null {
  if (!record(value) || !keys(value, ['canonical', 'source_sha256', 'manifest_sha256', 'preview_fingerprint', 'proposed_revision', 'changed_questions', 'validation_messages'])
      || value.source_sha256 !== sourceHash || !sha(sourceHash)
      || !['manifest_sha256', 'preview_fingerprint', 'proposed_revision'].every((k) => sha(value[k]))
      || !Array.isArray(value.changed_questions) || value.changed_questions.length > 200
      || !Array.isArray(value.validation_messages) || !value.validation_messages.every((x) => typeof x === 'string')) return null;
  const read = normalizeRevisionRead(value.canonical, canonical.canonical_code);
  if (!read || !sameScope(read, canonical)) return null;
  const seen = new Set<string>();
  for (const q of value.changed_questions) {
    if (!record(q) || !keys(q, ['qid', 'fields', 'before_sha256', 'after_sha256']) || typeof q.qid !== 'string' || !q.qid.length || seen.has(q.qid)
        || !sha(q.before_sha256) || !sha(q.after_sha256) || q.before_sha256 === q.after_sha256
        || !Array.isArray(q.fields) || !q.fields.length || new Set(q.fields).size !== q.fields.length
        || !q.fields.every((x) => typeof x === 'string' && (['prompt', 'hint', 'options', 'answer', 'accept', 'explain'].includes(x) || ['type', 'input'].includes(x) && REVIEWED_INPUT_QIDS[canonical.canonical_code]?.includes(q.qid as string)))) return null;
    seen.add(q.qid);
  }
  return {
    ...value,
    canonical: read,
    changed_questions: value.changed_questions.map((q) => ({ ...q, fields: q.fields.slice() })),
    validation_messages: value.validation_messages.slice(),
  } as RevisionPreview;
}
export function freezeRevisionCommand(actor: string, code: RevisionCode, source: string, preview: RevisionPreview, operation: string): FrozenRevisionCommand | null {
  const canonical = normalizeRevisionRead(preview?.canonical, code);
  if (!canonical || !normalizeRevisionPreview(preview, canonical, preview.source_sha256)) return null;
  if (!uuid(actor) || !uuid(operation) || !isGrammarRevisionCode(code) || sourceBytes(source) === null
      || preview.canonical.canonical_code !== code || !preview.canonical.publication_available || preview.canonical.footprint.authoritative_review_required) return null;
  const body = Object.freeze({ source_markdown: source, expected_revision: preview.canonical.revision, preview_fingerprint: preview.preview_fingerprint, operation_id: operation });
  if (!commandFits(body)) return null;
  return Object.freeze({ actor, code, body, sourceHash: preview.source_sha256, proposedRevision: preview.proposed_revision,
    originalBankId: preview.canonical.original_bank_id, rootBankId: preview.canonical.canonical_root_bank_id, topicId: preview.canonical.topic_id,
    originalQuestionsHash: preview.canonical.original_questions_sha256, originalMetadataHash: preview.canonical.original_metadata_sha256 });
}
export function normalizeRevisionAck(value: unknown, command: FrozenRevisionCommand): RevisionAck | null {
  if (!record(value) || !keys(value, ['canonical_code', 'operation_id', 'outcome', 'original_bank_id', 'corrected_bank_id', 'source_sha256', 'committed_revision', 'current_revision', 'current_matches_committed', 'original_questions_sha256', 'original_history_sha256', 'canonical'])
      || value.canonical_code !== command.code || value.operation_id !== command.body.operation_id
      || !['applied', 'already_applied'].includes(value.outcome as string)
      || value.original_bank_id !== command.originalBankId || !uuid(value.corrected_bank_id) || value.corrected_bank_id === value.original_bank_id
      || value.source_sha256 !== command.sourceHash || value.original_questions_sha256 !== command.originalQuestionsHash
      || !['committed_revision', 'current_revision', 'original_history_sha256'].every((k) => sha(value[k]))
      || typeof value.current_matches_committed !== 'boolean' || value.current_matches_committed !== (value.current_revision === value.committed_revision)) return null;
  const read = normalizeRevisionRead(value.canonical, command.code);
  if (!read || !read.is_managed || read.canonical_root_bank_id !== command.rootBankId
      || read.topic_id !== command.topicId || read.revision !== value.current_revision) return null;
  const originalIndex = read.bank_ids.indexOf(command.originalBankId);
  if (originalIndex < 0 || read.bank_ids[originalIndex + 1] !== value.corrected_bank_id) return null;
  if (value.current_matches_committed || read.current_bank_id === value.corrected_bank_id) {
    if (read.original_bank_id !== command.originalBankId || read.current_bank_id !== value.corrected_bank_id
      || read.current_bank_revision !== command.proposedRevision || read.original_questions_sha256 !== command.originalQuestionsHash
      || read.original_metadata_sha256 !== command.originalMetadataHash) return null;
  } else if (value.outcome !== 'already_applied' || command.code !== 'G-grammar-for-reading-long-sentence-untangling'
      || read.bank_ids.length !== 3 || originalIndex !== 0) return null;
  return { ...value, canonical: read } as RevisionAck;
}
/** Footprint may grow after commit. Content identities must still match the ACK. */
export function revisionReadbackMatches(value: RevisionRead, ack: RevisionAck): boolean {
  return sameScope(value, ack.canonical);
}
export function revisionError(caught: unknown): { message: string; permission: boolean } {
  const v = record(caught) ? caught : {};
  const status = v.status;
  const messages: Record<number, string> = {
    401: 'Phiên đăng nhập không còn hợp lệ. Đăng nhập lại để xác minh quyền.',
    403: 'Tài khoản hiện tại không có quyền sửa Grammar.',
    404: 'Không tìm thấy nguồn Grammar gốc trong phạm vi được phép. Không thể coi đây là lịch sử bằng không.',
    409: 'Nguồn, bản xem trước hoặc revision đã xung đột. Đọc lại trạng thái và kiểm tra nguồn.',
    422: 'Nội dung gửi không hợp lệ hoặc vượt giới hạn UTF-8/JSON 256KiB.',
    503: 'Chưa xác minh được nguồn, schema hoặc lịch sử. Không thể xác nhận đã lưu.',
  };
  const detail = record(v.detail) && typeof v.detail.message === 'string' ? v.detail.message : '';
  return { message: (typeof status === 'number' && messages[status]) || 'Không xác nhận được phản hồi. Kiểm tra kết nối và đọc lại trạng thái.', permission: status === 401 || status === 403, ...(detail ? { message: `${messages[status as number] || 'Thao tác chưa được xác nhận.'} ${detail}` } : {}) };
}
