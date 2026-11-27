'use client';

// ADMINIA-0074 FR-045 (G09-T14): the one re-practice grant form, shared by the
// class page (whole class or selected learners), the learner profile (one
// person) and the directory. G04 grants one learner per call: the form sends
// them in turn, and a failure part-way shows who was granted and who was not,
// with "Thử lại phần còn lại". Each learner keeps one request_key across
// retries, so a retry the server already applied replays instead of granting
// twice. Each open reads every learner's G04 access, so whoever already holds
// the course (including a grant whose answer was lost) is skipped; a failed
// read blocks the form instead of guessing. Nothing is rolled back here, and no
// activation code is created.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Dialog, Field, messageOf } from '@/components/admin-directory-ui';
import {
  REVIEW_MODES,
  grantBody,
  grantDraft,
  heldFromAccess,
  needsCourseCodes,
  practiceProducts,
  runSummary,
  validateGrant,
  type CourseProductWire,
  type GrantCheck,
  type GrantDraft,
  type GrantResult,
  type GrantUser,
  type HeldCourseIds,
} from '@/lib/admin-practice-grant-model.mjs';
import { getCourseCodes, getCourseProducts, getUserAccess, newRequestKey, postGrant } from '@/lib/admin-practice-grant-api';

type Props = {
  open: boolean;
  users: GrantUser[];
  /** The class's own course(s): never offered as re-practice. */
  excludeCourseIds?: string[];
  onClose: () => void;
  /** Called once a run ends with at least one learner granted; the caller refetches. */
  onGranted?: (grantedUserIds: string[]) => void;
};

type Run = { check: Extract<GrantCheck, { ok: true }>; results: Record<string, GrantResult> };
/** A confirm belongs to the inputs it was built from; it is never sent for others. */
type Confirm = Extract<GrantCheck, { ok: true }> & { inputKey: string };

const NO_IDS: string[] = [];

export function PracticeGrantForm({ open, users, excludeCourseIds = NO_IDS, onClose, onGranted }: Props) {
  const [products, setProducts] = useState<CourseProductWire[] | null>(null);
  // What each learner holds in force, read from G04 every time the form opens
  // (never taken from the caller), so a grant that already landed, even one
  // whose answer was lost, is skipped instead of granted again.
  const [heldCourseIds, setHeld] = useState<HeldCourseIds>({});
  const [reloadTick, setReloadTick] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // '' in productId / reviewMode means "not chosen": the single course on offer
  // and that course's own review mode apply. Derived at render, never written
  // back by an effect, so a late product list cannot overwrite what was typed.
  const [draft, setDraft] = useState<{ productId: string; days: string; reviewMode: GrantDraft['reviewMode'] | ''; reason: string; error?: string }>(
    { productId: '', days: '', reviewMode: '', reason: '' });
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [stale, setStale] = useState(false);
  // Once the first POST of a run is sent, that run keeps its recipients and
  // keys (retries go to the same learners); a change of inputs no longer resets it.
  const started = useRef(false);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = useRef<Record<string, string>>({});

  // Callers often pass fresh arrays each render: key the list on content so the
  // draft is not reset (and the form not re-rendered in a loop) on every render.
  const userKey = JSON.stringify(users.map((u) => u.id));
  const inputKey = JSON.stringify([excludeCourseIds, userKey, heldCourseIds]);
  const options = useMemo(
    () => practiceProducts(products, { excludeCourseIds, users, heldCourseIds }),
    [products, inputKey],
  );

  useEffect(() => {
    if (!open || started.current) return;
    let live = true;
    setProducts(null); setLoadError(null); setConfirm(null); setRun(null); setStale(false);
    setDraft({ productId: '', days: '', reviewMode: '', reason: '' });
    keys.current = {};
    setHeld({});
    const ids = users.map((u) => u.id);
    type Holding = { state: string; product_slug: string | null; course_code?: string | null };
    Promise.all([getCourseProducts(), Promise.allSettled(ids.map((id) => getUserAccess(id)))])
      .then(async ([out, reads]) => {
        if (!live) return;
        const failed = reads.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
        if (failed.length) {
          console.warn('[practice-grant] access reads failed', failed.length);
          setLoadError(`chưa đọc được quyền học hiện có của ${failed.length.toLocaleString('vi-VN')} người (${messageOf(failed[0].reason)})`);
          return;
        }
        const items = out.items ?? [];
        const holdings = reads.map((r) => (r as PromiseFulfilledResult<{ items: Holding[] }>).value.items);
        // Legacy codes and holdings whose product is archived need the
        // course-code lookup. A failed read blocks the form.
        const courses = holdings.some((h) => needsCourseCodes(h, items)) ? (await getCourseCodes()).courses ?? [] : [];
        if (!live) return;
        const held: HeldCourseIds = {};
        holdings.forEach((h, i) => { held[ids[i]] = heldFromAccess(h, items, courses); });
        setHeld(held);
        setProducts(items);
      })
      .catch((caught) => {
        if (!live) return;
        console.warn('[practice-grant] products or courses failed', caught);
        setLoadError(messageOf(caught));
      });
    return () => { live = false; };
    // users by content (userKey): callers pass a fresh array each render.
  }, [open, userKey, reloadTick]);

  const preset = grantDraft(options);
  const productId = draft.productId || preset.productId;
  const chosen = options.find((p) => p.id === productId);
  const effective: GrantDraft = {
    productId,
    days: draft.days,
    reviewMode: draft.reviewMode || chosen?.reviewMode || preset.reviewMode,
    reason: draft.reason,
  };

  const review = (event: FormEvent) => {
    event.preventDefault();
    const check = validateGrant(effective, options, users, heldCourseIds);
    if (!check.ok) { setDraft({ ...draft, error: check.error }); return; }
    setStale(false);
    setConfirm({ ...check, inputKey });
  };

  const send = async (check: Extract<GrantCheck, { ok: true }>, only: GrantUser[], prior: Record<string, GrantResult>) => {
    setBusy(true);
    const results: Record<string, GrantResult> = { ...prior };
    for (const user of only) delete results[user.id];
    setRun({ check, results: { ...results } });
    for (const user of only) {
      keys.current[user.id] ??= newRequestKey();
      try {
        await postGrant(grantBody(check.body, user.id, keys.current[user.id]));
        results[user.id] = { ok: true };
      } catch (caught) {
        results[user.id] = { ok: false, error: messageOf(caught) };
      }
      setRun({ check, results: { ...results } });
    }
    setBusy(false);
    const granted = check.targets.filter((u) => results[u.id]?.ok).map((u) => u.id);
    if (granted.length) onGranted?.(granted);
  };

  const start = () => {
    if (!confirm || busy) return;
    if (confirm.inputKey !== inputKey) {
      // The learners, the excluded course or what they hold changed after
      // "Tiếp tục": nothing is sent; the admin confirms the new list again.
      setConfirm(null);
      setStale(true);
      return;
    }
    const check = confirm;
    setConfirm(null);
    started.current = true;
    void send(check, check.targets, {});
  };

  const summary = run ? runSummary(run.check.targets, run.results) : null;
  const retry = () => {
    if (!run || !summary || busy) return;
    void send(run.check, [...summary.failed, ...summary.pending], run.results);
  };

  const close = () => { if (!busy) { started.current = false; onClose(); } };
  useEffect(() => { if (!open) started.current = false; }, [open]);

  if (run && summary) {
    return (
      <Dialog
        open={open}
        title="Kết quả cấp quyền luyện lại"
        busy={busy}
        onClose={close}
        actions={(
          <>
            {summary.failed.length && !busy ? (
              <button className="adm-btn-primary" type="button" onClick={retry}>Thử lại phần còn lại</button>
            ) : null}
            <button className="adm-btn-secondary" type="button" disabled={busy} onClick={close}>Đóng</button>
          </>
        )}
      >
        <p role="status">{busy ? `Đang cấp… ${summary.text}` : summary.text}</p>
        {summary.granted.length ? (
          <section aria-label="Đã cấp">
            <h3>Đã cấp</h3>
            <ul>{summary.granted.map((u) => <li key={u.id}>{u.name}</li>)}</ul>
          </section>
        ) : null}
        {summary.failed.length ? (
          <section aria-label="Chưa cấp">
            <h3>Chưa cấp</h3>
            <ul>{summary.failed.map((u) => <li key={u.id}>{u.name}: {u.error}</li>)}</ul>
          </section>
        ) : null}
        {run.check.already.length ? (
          <p>Bỏ qua vì đã có quyền: {run.check.already.map((u) => u.name).join(', ')}</p>
        ) : null}
      </Dialog>
    );
  }

  return (
    <>
      <Dialog
        open={open && !confirm}
        title="Cấp quyền luyện lại"
        description={users.length === 1 ? `Cho ${users[0].name}.` : `Cho ${users.length.toLocaleString('vi-VN')} người đã chọn.`}
        onClose={close}
        actions={(
          <>
            <button className="adm-btn-secondary" type="button" onClick={close}>Huỷ</button>
            <button className="adm-btn-primary" type="submit" form="practice-grant-form" disabled={!products || !options.length}>Tiếp tục</button>
          </>
        )}
      >
        {loadError ? (
          <p className="acd-banner is-error" role="alert">Chưa tải được danh sách khoá: {loadError}{' '}
            <button type="button" className="adm-btn-secondary" onClick={() => setReloadTick((n) => n + 1)}>Tải lại</button>
          </p>
        ) : null}
        {!products && !loadError ? <p role="status">Đang tải danh sách khoá…</p> : null}
        {products && !options.length ? <p>Không còn khoá luyện lại nào để cấp cho người đã chọn.</p> : null}
        {products && options.length ? (
          <form id="practice-grant-form" onSubmit={review}>
            <Field label="Khoá">
              <select value={effective.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value, reviewMode: '', error: '' })}>
                {options.length > 1 ? <option value="">Chọn khoá…</option> : null}
                {options.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </Field>
            <Field label="Thời hạn (ngày)" hint="Để trống thì theo mặc định của khoá.">
              <input inputMode="numeric" value={draft.days} onChange={(e) => setDraft({ ...draft, days: e.target.value, error: '' })} />
            </Field>
            <fieldset className="acd-field">
              <legend>Luồng chấm</legend>
              {REVIEW_MODES.map((m) => (
                <label key={m.value}>
                  <input type="radio" name="practice-grant-mode" checked={effective.reviewMode === m.value}
                    onChange={() => setDraft({ ...draft, reviewMode: m.value, error: '' })} /> {m.label}
                </label>
              ))}
            </fieldset>
            <Field label="Lý do">
              <textarea value={draft.reason} maxLength={500} onChange={(e) => setDraft({ ...draft, reason: e.target.value, error: '' })} />
            </Field>
            {draft.error ? <p className="acd-banner is-error" role="alert">{draft.error}</p> : null}
            {stale ? <p className="acd-banner is-error" role="alert">Danh sách người nhận đã thay đổi sau bước Tiếp tục. Chưa cấp cho ai; kiểm tra lại rồi bấm Tiếp tục.</p> : null}
          </form>
        ) : null}
      </Dialog>
      <Dialog
        open={open && Boolean(confirm)}
        title="Xác nhận cấp quyền"
        onClose={() => setConfirm(null)}
        actions={(
          <>
            <button className="adm-btn-secondary" type="button" onClick={() => setConfirm(null)}>Quay lại</button>
            <button className="adm-btn-primary" type="button" onClick={start}>Cấp quyền</button>
          </>
        )}
      >
        <p>{confirm?.confirmText}</p>
      </Dialog>
    </>
  );
}
