import {
  ExerciseBookError,
  KEEP_CHANGE_VERSION,
  type AcademicVerdict,
  type LearnerBinding,
  type CellStatus,
  type ErrorCode,
  type KeepChange,
  type PublicItem,
  type ReferenceProvenance,
  type ReviewItem,
  type SourceStatus,
} from './contract';

/**
 * The 7 learner binding fields, copied by name. Whatever else a payload
 * carries (a leaked `answer_set_revision`, say) is never echoed back (FR-013).
 */
export function learnerBinding(binding: LearnerBinding): LearnerBinding {
  return {
    programme_id: binding.programme_id,
    collection_id: binding.collection_id,
    source_contract: binding.source_contract,
    unit_id: binding.unit_id,
    activity_id: binding.activity_id,
    content_revision: binding.content_revision,
    policy_revision: binding.policy_revision,
  };
}

const READINESS_REASON: Record<string, string> = {
  audio_not_found: 'Chưa có audio',
  audio_incomplete_download: 'Audio tải chưa hoàn tất',
  original_options_unreviewed: 'Chờ kiểm tra lựa chọn gốc',
};

/** Screen-reader text for a locked activity (QA G10). Unknown reasons stay generic. */
export function readinessText(reasons: string[]) {
  const labels = reasons.map((reason) => READINESS_REASON[reason] || 'Chưa sẵn sàng');
  return labels.length ? labels.join(' · ') : 'Chưa sẵn sàng';
}

export const CELL_STATUS_LABEL: Record<CellStatus, string> = {
  not_started: 'Chưa bắt đầu',
  in_progress: 'Đang làm',
  submitted: 'Đã nộp',
  expired: 'Quá hạn',
  unavailable: 'Không khả dụng',
};

// QA G15: plain labels for the self-check metadata. Academic wording is owned by CM.
export const SOURCE_STATUS_LABEL: Record<SourceStatus, string> = {
  CONFIRMED: 'Đáp án nguồn đã được xác nhận',
  DISAGREEMENT: 'Các nguồn đáp án chưa thống nhất',
  UNRESOLVED: 'Chưa xác định được đáp án nguồn',
};

export const PROVENANCE_LABEL: Record<ReferenceProvenance, string> = {
  literal_key: 'Lấy nguyên từ đáp án của sách',
  derived: 'Suy ra từ đáp án của sách',
  editorial: 'Do biên tập viên soạn',
};

export const VERDICT_LABEL: Record<AcademicVerdict, string> = {
  CONFIRMED: 'Đã kiểm tra học thuật',
  SUSPECT: 'Cần xem lại',
  AMBIGUOUS: 'Có thể hiểu theo nhiều cách',
  UNRESOLVED: 'Chưa có kết luận học thuật',
};

const VN_TIME = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Contract timestamps shown in Vietnam time (QA G16). */
export function formatVnTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : `${VN_TIME.format(date)} (giờ VN)`;
}

/** `<input type="datetime-local">` value read as Asia/Ho_Chi_Minh wall time. */
export function vnLocalToIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+07:00` : '';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: string) {
  return UUID.test(value.trim());
}

const ERROR_TEXT: Record<ErrorCode, string> = {
  unauthenticated: 'Phiên đăng nhập đã hết. Hãy đăng nhập lại.',
  forbidden: 'Bạn chưa được cấp quyền cho mục này.',
  not_owner: 'Chỉ tài khoản được ủy quyền mới dùng được trang này.',
  step_up_required: 'Cần xác thực lại bằng mã MFA trước khi thực hiện thao tác này.',
  not_found: 'Không tìm thấy mục này, hoặc bạn không có quyền xem.',
  stale_revision: 'Nội dung bài đã được cập nhật. Hãy tải lại trang để lấy bản mới.',
  idempotency_conflict: 'Yêu cầu này trùng mã với một yêu cầu khác. Hãy tải lại trang rồi thử lại.',
  attempt_changed: 'Bài làm đã thay đổi ở nơi khác (đã nộp hoặc đã cập nhật). Hãy tải lại trang.',
  conflict: 'Trạng thái đã thay đổi. Hãy tải lại trang.',
  activity_locked: 'Activity này chưa mở hoặc chưa sẵn sàng.',
  past_due: 'Bài đã quá hạn nộp nên không mở, lưu hay nộp được nữa.',
  validation: 'Dữ liệu chưa hợp lệ. Hãy kiểm tra lại các ô đã nhập.',
  unavailable: 'Tính năng sách bài tập chưa sẵn sàng trên hệ thống.',
  network: 'Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.',
};

export function errorCode(caught: unknown): ErrorCode {
  return caught instanceof ExerciseBookError ? caught.code : 'network';
}

export function codeText(code: ErrorCode) {
  return ERROR_TEXT[code];
}

/** Fixed Vietnamese copy per contract code (QA G12); never the server text. */
export function errorText(caught: unknown) {
  return ERROR_TEXT[errorCode(caught)];
}

export function parseKeepChange(value: string | undefined): KeepChange {
  const empty: KeepChange = { version: KEEP_CHANGE_VERSION, action: null, correction_text: '' };
  if (!value) return empty;
  try {
    const parsed = JSON.parse(value) as Partial<KeepChange>;
    const action = parsed.action === 'KEEP' || parsed.action === 'CHANGE' ? parsed.action : null;
    return { version: KEEP_CHANGE_VERSION, action, correction_text: typeof parsed.correction_text === 'string' ? parsed.correction_text : '' };
  } catch {
    return empty;
  }
}

export function encodeKeepChange(value: KeepChange) {
  return JSON.stringify({ version: KEEP_CHANGE_VERSION, action: value.action, correction_text: value.correction_text });
}

/** A text cell is blank when empty; KEEP/CHANGE is blank until chosen, CHANGE needs its correction. */
export function isBlank(item: Pick<PublicItem, 'interaction'>, value = '') {
  if (item.interaction === 'text') return !value.trim();
  const parsed = parseKeepChange(value);
  return !parsed.action || (parsed.action === 'CHANGE' && !parsed.correction_text.trim());
}

/** Same label in the runner and in review (QA G13). */
export function itemLabel(item: Pick<PublicItem, 'source_display_number' | 'group_id' | 'row_id' | 'column_id'>) {
  const context = [item.group_id, item.row_id, item.column_id].filter(Boolean).join(' · ');
  return `Câu ${item.source_display_number}${context ? ` · ${context}` : ''}`;
}

const MISSING = 'chưa có';

/** Human text for a saved response or a reference: KEEP/CHANGE pairs, lists, or plain text. */
export function displayValue(value: ReviewItem['reference'] | string | undefined): string {
  if (value == null || value === '') return MISSING;
  if (Array.isArray(value)) return value.length ? value.map((entry) => displayValue(entry)).join(' / ') : MISSING;
  if (typeof value === 'object') {
    if (value.action === 'KEEP') return 'Giữ nguyên (KEEP)';
    return `Sửa (CHANGE): ${value.correction_text || MISSING}`;
  }
  if (value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as { version?: unknown; action?: unknown };
      if (parsed && parsed.version === KEEP_CHANGE_VERSION) {
        const pair = parseKeepChange(value);
        return pair.action ? displayValue({ version: KEEP_CHANGE_VERSION, action: pair.action, correction_text: pair.correction_text }) : MISSING;
      }
    } catch {
      // Plain text that starts with "{" stays as typed.
    }
  }
  return value;
}
