'use client';

// ADMINIA-0074 FR-045 (G09-T14): the one re-practice grant form, shared by the
// class page (whole class or selected learners), the learner profile (one
// person) and the directory. G04 grants one learner per call: the form sends
// them in turn, and a failure part-way shows who was granted and who was not,
// with "Thử lại phần còn lại". Each learner keeps one request_key across
// retries, so a retry the server already applied replays instead of granting
// twice. Nothing is rolled back here, and no activation code is created.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Dialog, Field, messageOf } from '@/components/admin-directory-ui';
import {
  REVIEW_MODES,
  grantBody,
  grantDraft,
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
import { getCourseProducts, newRequestKey, postGrant } from '@/lib/admin-practice-grant-api';

type Props = {
  open: boolean;
  users: GrantUser[];
  /** The class's own course(s): never offered as re-practice. */
  excludeCourseIds?: string[];
  /** Course ids each learner already holds in force, when the caller knows them. */
  heldCourseIds?: HeldCourseIds;
  onClose: () => void;
  /** Called once a run ends with at least one learner granted; the caller refetches. */
  onGranted?: (grantedUserIds: string[]) => void;
};

type Run = { check: Extract<GrantCheck, { ok: true }>; results: Record<string, GrantResult> };

const NO_IDS: string[] = [];
const NO_HELD: HeldCourseIds = {};

export function PracticeGrantForm({ open, users, excludeCourseIds = NO_IDS, heldCourseIds = NO_HELD, onClose, onGranted }: Props) {
  const [products, setProducts] = useState<CourseProductWire[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GrantDraft & { error?: string }>({ productId: '', days: '', reviewMode: 'ai_instant', reason: '' });
  const [confirm, setConfirm] = useState<Extract<GrantCheck, { ok: true }> | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = useRef<Record<string, string>>({});

  // Callers often pass fresh arrays each render: key the list on content so the
  // draft is not reset (and the form not re-rendered in a loop) on every render.
  const inputKey = JSON.stringify([excludeCourseIds, users.map((u) => u.id), heldCourseIds]);
  const options = useMemo(
    () => practiceProducts(products, { excludeCourseIds, users, heldCourseIds }),
    [products, inputKey],
  );

  useEffect(() => {
    if (!open) return;
    let live = true;
    setProducts(null); setLoadError(null); setConfirm(null); setRun(null);
    keys.current = {};
    getCourseProducts()
      .then((out) => { if (live) setProducts(out.items ?? []); })
      .catch((caught) => {
        if (!live) return;
        console.warn('[practice-grant] products failed', caught);
        setLoadError(messageOf(caught));
      });
    return () => { live = false; };
  }, [open]);

  useEffect(() => { if (products) setDraft(grantDraft(options)); }, [products, options]); // options is content-keyed

  const review = (event: FormEvent) => {
    event.preventDefault();
    const check = validateGrant(draft, options, users, heldCourseIds);
    if (!check.ok) { setDraft({ ...draft, error: check.error }); return; }
    setConfirm(check);
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
    const check = confirm;
    setConfirm(null);
    void send(check, check.targets, {});
  };

  const summary = run ? runSummary(run.check.targets, run.results) : null;
  const retry = () => {
    if (!run || !summary || busy) return;
    void send(run.check, [...summary.failed, ...summary.pending], run.results);
  };

  const close = () => { if (!busy) onClose(); };

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
        {loadError ? <p className="acd-banner is-error" role="alert">Chưa tải được danh sách khoá: {loadError}</p> : null}
        {!products && !loadError ? <p role="status">Đang tải danh sách khoá…</p> : null}
        {products && !options.length ? <p>Không còn khoá luyện lại nào để cấp cho người đã chọn.</p> : null}
        {products && options.length ? (
          <form id="practice-grant-form" onSubmit={review}>
            <Field label="Khoá">
              <select value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value, error: '' })}>
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
                  <input type="radio" name="practice-grant-mode" checked={draft.reviewMode === m.value}
                    onChange={() => setDraft({ ...draft, reviewMode: m.value, error: '' })} /> {m.label}
                </label>
              ))}
            </fieldset>
            <Field label="Lý do">
              <textarea value={draft.reason} maxLength={500} onChange={(e) => setDraft({ ...draft, reason: e.target.value, error: '' })} />
            </Field>
            {draft.error ? <p className="acd-banner is-error" role="alert">{draft.error}</p> : null}
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
