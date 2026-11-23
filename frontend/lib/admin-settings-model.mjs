// Trang Cài đặt /admin/settings (ADMINIA-0074 FR-080, FR-081, FR-084; plan
// 5.4, 5.6; sheet AdminCaiDat; G09-T23). Plain ES module: the page, its tests
// and the frame's ThresholdsProvider read it. No threshold number lives here:
// every value, range and unit comes from GET /admin/settings/thresholds.

/** The seven tabs of FR-080, in the sheet's order. `pending` = why it is not open yet. */
export const SETTINGS_TABS = Object.freeze([
  { id: 'payment', label: 'Thanh toán', pending: 'Chưa mở: tài khoản nhận học phí chờ quyết định Q20 và cấu hình đơn đăng ký của G04.' },
  { id: 'email', label: 'Thư gửi học viên', pending: 'Chưa mở: cần API đọc và ghi loại thư (G09-T23b) và địa chỉ gửi của G04.' },
  { id: 'legal', label: 'Nội dung pháp lý', pending: 'Chưa mở: nội dung pháp lý chính thức còn chờ (Q21).' },
  { id: 'features', label: 'Tính năng', pending: 'Chưa mở: bật/tắt công tắc phải ghi vào nhật ký cài đặt kèm lý do, việc này cần thêm ở máy chủ (G09-T23b).' },
  { id: 'trial', label: 'Chấm thử miễn phí', pending: 'Chưa mở: thẻ này do phần Chấm thử miễn phí (GOI-11) dựng.' },
  { id: 'notices', label: 'Thông báo hệ thống', pending: 'Chưa mở: cần API lịch bảo trì và dải thông báo có kiểm trùng kỳ thi (G09-T23b).' },
  { id: 'thresholds', label: 'Ngưỡng vận hành', pending: null },
]);
export const DEFAULT_SETTINGS_TAB = 'thresholds';
const TAB_IDS = new Set(SETTINGS_TABS.map((t) => t.id));

/** `?tab=` → a known tab; missing or unknown falls back to the only open one. */
export function parseSettingsTab(search) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  const tab = params.get('tab') || '';
  return TAB_IDS.has(tab) ? tab : DEFAULT_SETTINGS_TAB;
}

export function settingsTabHref(tab) {
  return `/admin/settings?tab=${encodeURIComponent(tab)}`;
}

/** Log `section` → the tab's label; an unknown section shows as sent. */
export function sectionLabel(section) {
  return SETTINGS_TABS.find((t) => t.id === section)?.label ?? String(section ?? '');
}

/**
 * Rows grouped in API order. A value of null reads "chưa có" on a fixed row
 * (no configured source) and "để trống · tắt" on an editable one.
 * @param {Array<{key:string, group:string}>} items
 */
export function thresholdGroups(items) {
  /** @type {Array<{group:string, rows:any[]}>} */
  const groups = [];
  for (const row of Array.isArray(items) ? items : []) {
    let g = groups.find((x) => x.group === row.group);
    if (!g) { g = { group: row.group, rows: [] }; groups.push(g); }
    g.rows.push(row);
  }
  return groups;
}

export function valueText(row, value = row?.value) {
  if (value === null || value === undefined) return row?.fixed ? 'chưa có' : 'để trống (tắt)';
  return `${value} ${row?.unit ?? ''}`.trim();
}

export function rangeText(row) {
  if (row?.fixed) return 'Cố định, lấy từ cấu hình; không sửa ở trang này.';
  if (row?.min === null || row?.min === undefined || row?.max === null || row?.max === undefined) return '';
  return `Từ ${row.min} đến ${row.max}.`;
}

/**
 * What the field holds → the value to send, or an error under the field.
 * Empty sends null: the server says whether that row may be empty (only rows
 * whose reason can be switched off), so the page never guesses.
 * @returns {{ value: number | null, error: string | null }}
 */
export function parseThresholdInput(row, text) {
  const raw = String(text ?? '').trim();
  if (raw === '') return { value: null, error: null };
  if (!/^\d+$/.test(raw)) return { value: null, error: 'Chỉ nhập số nguyên, không có chữ hay dấu.' };
  const value = Number(raw);
  if (typeof row?.min === 'number' && typeof row?.max === 'number' && (value < row.min || value > row.max)) {
    return { value, error: `Từ ${row.min} đến ${row.max}.` };
  }
  return { value, error: null };
}

/** Initial field text for each editable row. */
export function draftsOf(items) {
  /** @type {Record<string, string>} */
  const drafts = {};
  for (const row of Array.isArray(items) ? items : []) {
    if (!row.fixed) drafts[row.key] = row.value === null || row.value === undefined ? '' : String(row.value);
  }
  return drafts;
}

/**
 * The rows whose field differs from the value read, with field errors.
 * @returns {{ changes: Array<{key:string,label:string,group:string,from:any,to:any,row:any}>, errors: Record<string,string> }}
 */
export function thresholdChanges(items, drafts) {
  const changes = [];
  /** @type {Record<string,string>} */
  const errors = {};
  for (const row of Array.isArray(items) ? items : []) {
    if (row.fixed || !(row.key in (drafts || {}))) continue;
    const { value, error } = parseThresholdInput(row, drafts[row.key]);
    if (error) { errors[row.key] = error; continue; }
    const from = row.value ?? null;
    if (value !== from) changes.push({ key: row.key, label: row.label, group: row.group, from, to: value, row });
  }
  return { changes, errors };
}

export const RETENTION_GROUP = 'Lưu dữ liệu';

/** FR-084: a shorter retention (or none) deletes data that cannot be brought back. */
export function retentionWarning(changes) {
  const shorter = (changes || []).filter((c) => c.group === RETENTION_GROUP
    && (c.to === null || (typeof c.from === 'number' && c.to < c.from)));
  if (!shorter.length) return null;
  return `Giảm thời gian lưu (${shorter.map((c) => c.label).join(', ')}): dữ liệu cũ hơn ngưỡng mới bị xoá ở lần dọn kế tiếp và không lấy lại được.`;
}

export function changeLine(c) {
  return `${c.label}: ${valueText(c.row ?? {}, c.from)} → ${valueText(c.row ?? {}, c.to)}`;
}

export function patchBody(changes, reason) {
  return { changes: changes.map((c) => ({ key: c.key, value: c.to })), reason: String(reason ?? '').trim() };
}

// The PATCH refuses before writing with one of these (422); anything else
// (5xx reaches the client as internal_error, or the network) may have
// committed, so the page says the outcome is unknown and reloads.
const REFUSED = new Set(['out_of_range', 'unknown_key', 'fixed', 'duplicate_key', 'no_changes', 'reason_required']);

/** @returns {{ text: string, key: string | null, refused: boolean }} */
export function thresholdSaveError(caught) {
  const err = /** @type {any} */ (caught) || {};
  if (REFUSED.has(err.code) && err.message) {
    const key = err.detail && typeof err.detail === 'object' && typeof err.detail.key === 'string' ? err.detail.key : null;
    return { text: `Chưa lưu: ${err.message}`, key, refused: true };
  }
  return {
    text: `Chưa chắc các ngưỡng đã được lưu (${err.message || 'lỗi không xác định'}). Đã tải lại bảng để xem giá trị hiện tại; kiểm tra lại trước khi lưu lần nữa.`,
    key: null,
    refused: false,
  };
}

const TIME = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

export function logTime(iso) {
  const d = new Date(String(iso ?? ''));
  return Number.isNaN(d.getTime()) ? 'không rõ' : TIME.format(d);
}

function logValue(v) {
  if (v === null || v === undefined) return 'trống';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * One settings-log row for the table at the end of every tab (sheet §8).
 * @returns {{ id: any, at: string, who: string, tab: string, what: string[], why: string }}
 */
export function logRow(item) {
  const changes = Array.isArray(item?.changes) ? item.changes : [];
  return {
    id: item?.id,
    at: logTime(item?.at),
    who: item?.actor_name || 'Không rõ người sửa',
    tab: sectionLabel(item?.section),
    what: changes.length ? changes.map((c) => `${c.label || c.key}: ${logValue(c.old)} → ${logValue(c.new)}`) : ['Không có giá trị nào đổi'],
    why: item?.reason ?? '',
  };
}

/** Thresholds by key for other pages (ThresholdsProvider): null while unknown. */
export function thresholdMap(items) {
  /** @type {Record<string, number | null>} */
  const map = {};
  for (const row of Array.isArray(items) ? items : []) map[row.key] = row.value ?? null;
  return map;
}
