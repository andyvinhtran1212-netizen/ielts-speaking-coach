import type { components } from '../types/api';

export const GRAMMAR_REVISION_CODES = Object.freeze([
  'G-parts-of-speech-verbs', 'G-sentence-structures-passive-voice',
  'G-tenses-past-continuous', 'G-tenses-present-continuous',
  'G-tenses-present-perfect-continuous', 'G-tenses-present-simple',
  'G-grammar-for-reading-participle-clauses', 'G-grammar-for-reading-long-sentence-untangling',
  'G-grammar-for-reading-reduced-relative-clauses', 'G-tenses-past-perfect',
  'G-foundations-phrase-vs-clause', 'G-error-clinic-dangling-modifiers',
] as const);
export type RevisionCode = typeof GRAMMAR_REVISION_CODES[number];
export type RevisionRead = components['schemas']['GrammarRevisionRead'];
export type RevisionPreview = components['schemas']['GrammarRevisionPreview'];
export type RevisionAck = components['schemas']['GrammarRevisionCommitResult'];
export type CommitBody = components['schemas']['GrammarRevisionCommitRequest'];
export type FrozenRevisionCommand = Readonly<{
  actor: string; code: RevisionCode; body: Readonly<CommitBody>;
  sourceHash: string; proposedRevision: string; originalBankId: string; topicId: string;
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
  if (!record(value) || !keys(value, ['canonical_code', 'original_bank_id', 'current_bank_id', 'topic_id', 'revision', 'current_bank_revision', 'original_questions_sha256', 'original_metadata_sha256', 'is_managed', 'new_starts_enabled', 'footprint'])
      || value.canonical_code !== code || !isGrammarRevisionCode(code)
      || !['original_bank_id', 'current_bank_id', 'topic_id'].every((key) => uuid(value[key]))
      || !['revision', 'current_bank_revision', 'original_questions_sha256', 'original_metadata_sha256'].every((key) => sha(value[key]))
      || typeof value.is_managed !== 'boolean' || typeof value.new_starts_enabled !== 'boolean'
      || (value.is_managed ? value.original_bank_id === value.current_bank_id : value.original_bank_id !== value.current_bank_id)) return null;
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
  return structuredClone(value) as RevisionRead;
}
const sameScope = (a: RevisionRead, b: RevisionRead) => ['canonical_code', 'original_bank_id', 'current_bank_id', 'topic_id', 'revision', 'current_bank_revision', 'original_questions_sha256', 'original_metadata_sha256', 'is_managed', 'new_starts_enabled'].every((k) => a[k as keyof RevisionRead] === b[k as keyof RevisionRead]);
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
        || !q.fields.every((x) => typeof x === 'string' && ['prompt', 'hint', 'options', 'answer', 'accept', 'explain'].includes(x))) return null;
    seen.add(q.qid);
  }
  return structuredClone(value) as RevisionPreview;
}
export function freezeRevisionCommand(actor: string, code: RevisionCode, source: string, preview: RevisionPreview, operation: string): FrozenRevisionCommand | null {
  const canonical = normalizeRevisionRead(preview?.canonical, code);
  if (!canonical || !normalizeRevisionPreview(preview, canonical, preview.source_sha256)) return null;
  if (!uuid(actor) || !uuid(operation) || !isGrammarRevisionCode(code) || sourceBytes(source) === null
      || preview.canonical.canonical_code !== code || preview.canonical.is_managed || preview.canonical.footprint.authoritative_review_required) return null;
  const body = Object.freeze({ source_markdown: source, expected_revision: preview.canonical.revision, preview_fingerprint: preview.preview_fingerprint, operation_id: operation });
  if (!commandFits(body)) return null;
  return Object.freeze({ actor, code, body, sourceHash: preview.source_sha256, proposedRevision: preview.proposed_revision,
    originalBankId: preview.canonical.original_bank_id, topicId: preview.canonical.topic_id,
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
  if (!read || !read.is_managed || read.original_bank_id !== command.originalBankId || read.current_bank_id !== value.corrected_bank_id
      || read.topic_id !== command.topicId || read.revision !== value.current_revision || read.current_bank_revision !== command.proposedRevision
      || read.original_questions_sha256 !== command.originalQuestionsHash || read.original_metadata_sha256 !== command.originalMetadataHash) return null;
  return structuredClone(value) as RevisionAck;
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
