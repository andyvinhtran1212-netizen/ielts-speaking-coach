// Quyền luyện lại và thu hồi quyền (ADMINIA-0074 FR-045, FR-046; G09-T14).
// Pure helpers for the shared PracticeGrantForm and RevokeAccessForm. Every
// course, length and default comes from G04 (`GET /admin/course-products`);
// the grant itself is `POST /admin/entitlements`, one learner per call, so a
// failure part-way leaves a list of who was granted and who was not. Nothing
// is rolled back on the client and no activation code is created.

export const REASON_MIN = 10;
export const REASON_MAX = 500;
export const DAYS_MAX = 3650;
export const REVIEW_MODES = [
  { value: 'ai_instant', label: 'AI trả ngay' },
  { value: 'teacher_review', label: 'Qua giáo viên duyệt' },
];

export function productTitle(product) {
  return product?.short_title || product?.title || product?.slug || 'Khoá không tên';
}

/**
 * Courses offered for re-practice: G04 `repractice` products that are not
 * archived and not drafts, minus the class's own course (`excludeCourseIds`).
 * With a single learner, a course they already hold in force is left out too.
 */
export function practiceProducts(products, { excludeCourseIds = [], users = [], heldCourseIds = {} } = {}) {
  const excluded = new Set(excludeCourseIds.map((id) => String(id).toLowerCase()));
  const single = users.length === 1 ? new Set((heldCourseIds[users[0].id] ?? []).map((id) => String(id).toLowerCase())) : null;
  return (products ?? [])
    .filter((p) => p.kind === 'repractice' && !p.archived_at && p.status !== 'draft')
    .filter((p) => !excluded.has(String(p.course_id).toLowerCase()))
    .filter((p) => !single || !single.has(String(p.course_id).toLowerCase()))
    .map((p) => ({
      id: String(p.id),
      courseId: String(p.course_id),
      title: productTitle(p),
      days: p.access_days ?? null,
      reviewMode: p.review_mode === 'teacher_review' ? 'teacher_review' : 'ai_instant',
    }));
}

/**
 * Course ids a learner holds in force, from G04 `GET /admin/users/{id}/access`
 * items. An entitlement names its product by slug, matched to
 * `/admin/course-products`. When the slug is absent from that catalog, use the
 * access row's course code. An archived product can still confer active access.
 */
export function heldFromAccess(items, products, courses = []) {
  const bySlug = new Map((products ?? []).filter((p) => p.slug).map((p) => [String(p.slug), String(p.course_id)]));
  const byCode = new Map((courses ?? []).filter((c) => c?.code).map((c) => [String(c.code), String(c.id)]));
  const out = new Set();
  for (const item of items ?? []) {
    if (item?.state !== 'active') continue;
    const productCourse = item.product_slug ? bySlug.get(item.product_slug) : undefined;
    const course = productCourse ?? (item.course_code ? byCode.get(item.course_code) : undefined);
    if (course) out.add(course);
  }
  return [...out];
}

/** True when a holding needs its course code because the catalog cannot resolve its slug. */
export function needsCourseCodes(items, products) {
  const slugs = new Set((products ?? []).map((product) => product.slug));
  return (items ?? []).some((item) =>
    item?.state === 'active' && item.course_code && (!item.product_slug || !slugs.has(item.product_slug)));
}

export function grantDraft(products) {
  const only = products.length === 1 ? products[0] : null;
  return { productId: only ? only.id : '', days: '', reviewMode: only ? only.reviewMode : 'ai_instant', reason: '' };
}

/** Client check before the confirm step; the server re-checks everything. */
export function validateGrant(draft, products, users, heldCourseIds = {}) {
  const product = products.find((p) => p.id === draft.productId);
  if (!product) return { ok: false, error: 'Chọn khoá luyện lại.' };
  if (!users.length) return { ok: false, error: 'Chưa chọn học viên nào.' };
  const daysText = String(draft.days ?? '').trim();
  let days = null;
  if (daysText) {
    if (!/^\d+$/.test(daysText) || Number(daysText) < 1) return { ok: false, error: 'Thời hạn phải là số ngày nguyên dương.' };
    days = Number(daysText);
    if (days > DAYS_MAX) return { ok: false, error: `Thời hạn tối đa ${DAYS_MAX.toLocaleString('vi-VN')} ngày.` };
  }
  if (!REVIEW_MODES.some((m) => m.value === draft.reviewMode)) return { ok: false, error: 'Chọn luồng chấm.' };
  const reason = String(draft.reason || '').trim();
  if (reason.length < REASON_MIN) return { ok: false, error: `Lý do cần ít nhất ${REASON_MIN} ký tự.` };
  if (reason.length > REASON_MAX) return { ok: false, error: `Lý do tối đa ${REASON_MAX} ký tự.` };
  const course = product.courseId.toLowerCase();
  const already = users.filter((u) => (heldCourseIds[u.id] ?? []).some((id) => String(id).toLowerCase() === course));
  const targets = users.filter((u) => !already.includes(u));
  if (!targets.length) return { ok: false, error: 'Mọi người đã chọn đều đang có quyền khoá này.' };
  const length = days ?? product.days;
  const mode = REVIEW_MODES.find((m) => m.value === draft.reviewMode).label;
  return {
    ok: true,
    product,
    targets,
    already,
    body: { product_id: product.id, days, review_mode: draft.reviewMode, reason },
    confirmText: `Cấp quyền luyện lại khoá “${product.title}” cho ${targets.length.toLocaleString('vi-VN')} người`
      + `${length ? `, ${Number(length).toLocaleString('vi-VN')} ngày` : ''}, chấm ${mode.toLowerCase()}. Lý do: “${reason}”.`
      + (already.length ? ` Bỏ qua ${already.length.toLocaleString('vi-VN')} người đã có quyền.` : ''),
  };
}

/** One request body per learner; `keys` keeps each learner's request_key across retries. */
export function grantBody(body, userId, key) {
  const out = { user_id: userId, product_id: body.product_id, review_mode: body.review_mode, reason: body.reason, request_key: key };
  if (body.days != null) out.days = body.days;
  return out;
}

/** `results`: { [userId]: { ok: true } | { ok: false, error } } → the result lists the dialog shows. */
export function runSummary(targets, results) {
  const granted = targets.filter((u) => results[u.id]?.ok === true);
  const failed = targets.filter((u) => results[u.id] && results[u.id].ok === false)
    .map((u) => ({ ...u, error: results[u.id].error }));
  const pending = targets.filter((u) => !results[u.id]);
  return {
    granted,
    failed,
    pending,
    done: !failed.length && !pending.length,
    text: `Đã cấp cho ${granted.length.toLocaleString('vi-VN')}/${targets.length.toLocaleString('vi-VN')} người.`,
  };
}

function normName(text) {
  return String(text ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** FR-046: typed full name must match, reason required. */
export function validateRevoke(draft, learnerName) {
  const name = normName(learnerName);
  if (!name) return { ok: false, error: 'Học viên chưa có họ tên để đối chiếu; không thu hồi ở đây được.' };
  if (normName(draft.typedName) !== name) return { ok: false, error: 'Họ tên gõ vào chưa khớp.' };
  const reason = String(draft.reason || '').trim();
  if (reason.length < REASON_MIN) return { ok: false, error: `Lý do cần ít nhất ${REASON_MIN} ký tự.` };
  if (reason.length > REASON_MAX) return { ok: false, error: `Lý do tối đa ${REASON_MAX} ký tự.` };
  return { ok: true, body: { reason } };
}
