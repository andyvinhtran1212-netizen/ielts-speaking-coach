// Sổ lượt AI /admin/credits (ADMINIA-0074 FR-047, FR-054, FR-056; G09-T15).
// Pure helpers: every number and label comes from G04
// (GET /admin/users/{id}/access, GET /admin/users/{id}/credits); nothing here
// adds up a balance, works out a carry-over or writes a percentage.

export const HISTORY_PAGE_SIZE = 20;
export const REASON_MIN = 10;
export const REASON_MAX = 500;
export const DELTA_MAX = 100000;
export const OTHER_LABEL = 'Điều chỉnh khác';
export const LOW_CREDITS_HREF = '/admin/learners?attention=low_credits';
/** FR-054: the grant-extra dialog belongs to the class page (G09-T29). */
export const GRANT_EXTRA_HREF = '/admin/classes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?ref=u-<users.id>` (FR-022 learner ref) → the user id, or null. */
export function userIdFromRef(ref) {
  const text = String(ref || '').trim();
  if (!text.startsWith('u-')) return null;
  const id = text.slice(2);
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

/** dd/mm/yyyy in Vietnam time, or '' for a missing/invalid timestamp. */
export function dateVi(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')}`;
}

export function dateTimeVi(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
  return `${dateVi(iso)} ${time}`;
}

export function signed(n) {
  const value = Number(n) || 0;
  return value > 0 ? `+${value.toLocaleString('vi-VN')}` : value.toLocaleString('vi-VN');
}

const STATE_TEXT = { active: 'Còn hiệu lực', expired: 'Đã hết hạn', revoked: 'Đã thu hồi' };

export function courseTitle(item) {
  return item?.short_title || item?.title || item?.course_code || 'Khoá không tên';
}

/**
 * One card per course access that has a credit pool (FR-047: the balance is
 * per course, one pool for Writing and Speaking). Access without a pool (a
 * legacy class code) is listed with `credits: null` so it is not mistaken for
 * zero.
 */
export function balanceCards(access) {
  return (access?.items ?? []).map((item) => {
    const credits = item.credits ?? null;
    const carry = credits && Number(credits.carry_balance) > 0 && credits.carry_expires_at
      ? { count: Number(credits.carry_balance), until: dateVi(credits.carry_expires_at) }
      : null;
    return {
      key: item.entitlement_id || `${item.kind}:${item.course_code || item.product_slug || courseTitle(item)}`,
      entitlementId: item.entitlement_id || null,
      title: courseTitle(item),
      state: item.state,
      stateText: STATE_TEXT[item.state] || item.state || '',
      expires: dateVi(item.expires_at),
      balance: credits ? Number(credits.balance) || 0 : null,
      usableFrom: credits?.usable_from ? dateVi(credits.usable_from) : '',
      carry,
      carryText: carry ? `trong đó ${carry.count.toLocaleString('vi-VN')} lượt chuyển, dùng tới ${carry.until}` : '',
    };
  });
}

/** "Điều chỉnh lượt" offers only an entitlement still in force with a pool. */
export function adjustableCourses(access) {
  return balanceCards(access).filter((c) => c.entitlementId && c.state === 'active' && c.balance !== null);
}

/**
 * Ledger rows as shown. `label_vi` is the server's; an unknown reason with no
 * label reads "Điều chỉnh khác". A carry_over row adds the carry's own expiry
 * when G04 returns it for that entitlement (FR-056); otherwise nothing is
 * guessed.
 */
export function historyRows(history, access) {
  const carryUntil = new Map();
  for (const item of access?.items ?? []) {
    if (item.entitlement_id && item.credits?.carry_expires_at) {
      carryUntil.set(String(item.entitlement_id), dateVi(item.credits.carry_expires_at));
    }
  }
  const titles = new Map((access?.items ?? []).filter((i) => i.entitlement_id)
    .map((i) => [String(i.entitlement_id), courseTitle(i)]));
  return (history?.items ?? []).map((row, index) => {
    const label = String(row.label_vi || '').trim() || OTHER_LABEL;
    const until = row.reason === 'carry_over' && row.entitlement_id ? carryUntil.get(String(row.entitlement_id)) : '';
    const actor = row.actor ? (row.actor.display_name || row.actor.email || '') : '';
    return {
      key: `${row.at || ''}:${index}`,
      at: dateTimeVi(row.at),
      label,
      detail: until ? `${Math.abs(Number(row.delta) || 0).toLocaleString('vi-VN')} lượt, dùng tới ${until}` : '',
      delta: signed(row.delta),
      positive: Number(row.delta) > 0,
      course: (row.entitlement_id && titles.get(String(row.entitlement_id))) || row.course_code || '',
      actor,
      note: row.note || '',
      balanceAfter: Number(row.balance_after ?? 0).toLocaleString('vi-VN'),
    };
  });
}

export function adjustDraft(courses) {
  return { entitlementId: courses.length === 1 ? courses[0].entitlementId : '', direction: 'add', amount: '', reason: '' };
}

/** Client check before the confirm step; the server re-checks everything. */
export function validateAdjust(draft, courses) {
  const course = courses.find((c) => c.entitlementId === draft.entitlementId);
  if (!course) return { ok: false, error: 'Chọn khoá còn hiệu lực cần điều chỉnh.' };
  const text = String(draft.amount ?? '').trim();
  if (!/^\d+$/.test(text) || Number(text) < 1) return { ok: false, error: 'Số lượt phải là số nguyên dương.' };
  const amount = Number(text);
  if (amount > DELTA_MAX) return { ok: false, error: `Mỗi lần điều chỉnh tối đa ${DELTA_MAX.toLocaleString('vi-VN')} lượt.` };
  const reason = String(draft.reason || '').trim();
  if (reason.length < REASON_MIN) return { ok: false, error: `Lý do cần ít nhất ${REASON_MIN} ký tự.` };
  if (reason.length > REASON_MAX) return { ok: false, error: `Lý do tối đa ${REASON_MAX} ký tự.` };
  const delta = draft.direction === 'subtract' ? -amount : amount;
  return {
    ok: true,
    course,
    body: { entitlement_id: course.entitlementId, delta, reason },
    confirmText: `${delta > 0 ? 'Cộng' : 'Trừ'} ${amount.toLocaleString('vi-VN')} lượt ${delta > 0 ? 'vào' : 'khỏi'} khoá “${course.title}”. Lý do: “${reason}”.`,
  };
}
