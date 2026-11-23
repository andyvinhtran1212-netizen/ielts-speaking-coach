'use client';

// Sổ lượt AI (ADMINIA-0074 FR-047, FR-054, FR-056; G09-T15). Find a learner,
// then read the per-course balances and the append-only ledger from G04
// (GET /admin/users/{id}/access, GET /admin/users/{id}/credits). The page never
// adds up a balance or works out a carry-over: after an adjustment it reloads
// both reads. Rows have no edit or delete action.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog, Field, messageOf, StatusBanner } from '@/components/admin-directory-ui';
import {
  findLearners,
  getUserAccess,
  getUserCredits,
  postCreditAdjust,
  type LearnerMatchWire,
  type LedgerRowWire,
  type UserAccessWire,
} from '@/lib/admin-credits-api';
import {
  GRANT_EXTRA_HREF,
  HISTORY_PAGE_SIZE,
  LOW_CREDITS_HREF,
  REASON_MAX,
  REASON_MIN,
  adjustDraft,
  adjustableCourses,
  balanceCards,
  historyRows,
  userIdFromRef,
  validateAdjust,
} from '@/lib/admin-credits-model.mjs';

type Banner = { kind: 'success' | 'error'; text: string } | null;
type Draft = ReturnType<typeof adjustDraft> & { error?: string };
type Confirm = { body: { entitlement_id: string; delta: number; reason: string }; text: string; requestKey: string };
type Ledger = { balance: number; items: LedgerRowWire[]; nextCursor: string | null };

function newRequestKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
      (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

export function AdminCredits() {
  const admin = useAdminProfile();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const ref = search?.get('ref') ?? '';
  const userId = useMemo(() => userIdFromRef(ref), [ref]);

  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<LearnerMatchWire[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [access, setAccess] = useState<UserAccessWire | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped by every load and every change of learner: a late "Tải thêm"
  // answer for an earlier learner or an earlier load is dropped.
  const sequence = useRef(0);
  // The key of an adjustment not yet confirmed by the server. Re-confirming
  // the same learner, course, delta and reason (after a timeout, say) reuses
  // it, so the server replays instead of writing a second row.
  const pendingKey = useRef<{ userId: string; body: string; key: string } | null>(null);

  const load = useCallback(async (id: string) => {
    const seq = ++sequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [a, c] = await Promise.all([getUserAccess(id), getUserCredits(id, HISTORY_PAGE_SIZE)]);
      if (seq !== sequence.current) return false;
      setAccess(a);
      setLedger({ balance: c.balance, items: c.items ?? [], nextCursor: c.next_cursor ?? null });
      return true;
    } catch (caught) {
      if (seq !== sequence.current) return false;
      console.warn('[admin-credits] load failed', caught);
      setLoadError(messageOf(caught));
      return false;
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setAccess(null); setLedger(null); setBanner(null); setMoreBusy(false);
    if (userId) void load(userId);
    else sequence.current += 1;
  }, [load, userId, admin.id]);

  const cards = useMemo(() => balanceCards(access), [access]);
  const courses = useMemo(() => adjustableCourses(access), [access]);
  const rows = useMemo(() => historyRows(ledger, access), [ledger, access]);

  const find = async (event: FormEvent) => {
    event.preventDefault();
    const text = q.trim();
    if (!text) return;
    setSearching(true); setSearchError(null);
    try {
      const out = await findLearners(text);
      setMatches(out.items ?? []);
    } catch (caught) {
      setMatches(null); setSearchError(messageOf(caught));
    } finally { setSearching(false); }
  };

  const choose = (row: LearnerMatchWire) => {
    setMatches(null);
    router.push(`${pathname}?ref=${encodeURIComponent(row.ref)}`);
  };

  const more = async () => {
    if (!userId || !ledger?.nextCursor || moreBusy) return;
    const seq = sequence.current;
    setMoreBusy(true);
    try {
      const c = await getUserCredits(userId, HISTORY_PAGE_SIZE, ledger.nextCursor);
      if (seq !== sequence.current) return;
      setLedger((cur) => (cur ? { balance: c.balance, items: [...cur.items, ...(c.items ?? [])], nextCursor: c.next_cursor ?? null } : cur));
    } catch (caught) {
      if (seq !== sequence.current) return;
      setBanner({ kind: 'error', text: `Chưa tải thêm được lịch sử: ${messageOf(caught)}` });
    } finally { if (seq === sequence.current) setMoreBusy(false); }
  };

  const review = (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    const check = validateAdjust(draft, courses);
    if (!check.ok) { setDraft({ ...draft, error: check.error }); return; }
    // Same learner and same adjustment as one the server has not confirmed →
    // same key (a retry replays); anything else is a new adjustment.
    const body = JSON.stringify(check.body);
    const pending = pendingKey.current;
    const requestKey = pending && userId && pending.userId === userId && pending.body === body ? pending.key : newRequestKey();
    if (userId) pendingKey.current = { userId, body, key: requestKey };
    setConfirm({ body: check.body, text: check.confirmText, requestKey });
    setConfirmError(null);
  };

  const submit = async () => {
    if (!confirm || !userId || busy) return;
    setBusy(true); setConfirmError(null);
    try {
      await postCreditAdjust({ ...confirm.body, request_key: confirm.requestKey });
      pendingKey.current = null;
      setConfirm(null); setDraft(null);
      const fresh = await load(userId);
      setBanner(fresh ? { kind: 'success', text: 'Đã ghi điều chỉnh vào sổ lượt.' }
        : { kind: 'error', text: 'Đã ghi điều chỉnh, nhưng chưa tải lại được sổ lượt; bấm Tải lại.' });
    } catch (caught) {
      // The server's message as it is (would_go_negative, not_usable, …).
      setConfirmError(messageOf(caught));
    } finally { setBusy(false); }
  };

  return (
    <main className="cr-shell">
      <header className="cr-header">
        <div>
          <h1>Lượt AI</h1>
          <p className="subtitle">Sổ lượt chấm AI theo từng khoá: một kho chung cho Writing và Speaking. Sổ chỉ ghi thêm; muốn sửa thì ghi một dòng điều chỉnh.</p>
        </div>
        <div className="cr-header__actions">
          <a className="adm-btn-secondary" href={GRANT_EXTRA_HREF}>Cấp thêm lượt cho học viên/lớp…</a>
        </div>
      </header>

      <section className="cr-low" aria-labelledby="cr-low-title">
        <h2 id="cr-low-title">Sắp hết lượt chấm</h2>
        <p>Học viên còn ít lượt theo ngưỡng “Sắp hết lượt chấm AI” trong Cài đặt. <a href={LOW_CREDITS_HREF}>Mở danh bạ đã lọc</a></p>
      </section>

      <form className="cr-search" role="search" aria-label="Tìm học viên" onSubmit={find}>
        <Field label="Tìm học viên">
          <input type="search" value={q} maxLength={128} placeholder="Tên, email hoặc mã học viên" onChange={(e) => setQ(e.target.value)} />
        </Field>
        <button className="adm-btn-primary" type="submit" disabled={searching || !q.trim()}>{searching ? 'Đang tìm…' : 'Tìm'}</button>
      </form>
      {searchError ? <p className="cr-warning" role="alert">Chưa tìm được: {searchError}</p> : null}
      {matches ? (
        matches.length ? (
          <ul className="cr-matches" aria-label="Kết quả tìm">
            {matches.map((row) => (
              <li key={row.ref}>
                <button className="cr-match" type="button" onClick={() => choose(row)}>
                  <strong>{row.name}</strong>
                  <span>{[row.email, row.student_code].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="cr-empty">Không có ai khớp “{q.trim()}”.</p>
      ) : null}

      <StatusBanner banner={banner} />

      {ref && !userId ? (
        <p className="cr-warning" role="status">Người này chưa có tài khoản đăng nhập nên chưa có sổ lượt.</p>
      ) : null}
      {!ref ? <p className="cr-empty">Tìm một học viên để xem số dư theo khoá và lịch sử lượt.</p> : null}

      {loadError ? (
        <div className="cr-warning" role="alert">
          Chưa tải được sổ lượt: {loadError}{' '}
          <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => userId && void load(userId)}>Tải lại</button>
        </div>
      ) : null}
      {userId && loading && !access ? <p className="cr-empty" role="status">Đang tải sổ lượt…</p> : null}

      {access && ledger ? (
        <>
          <section className="cr-balances" aria-labelledby="cr-balance-title">
            <div className="cr-balances__head">
              <h2 id="cr-balance-title">Số dư theo khoá</h2>
              <span>Còn dùng được: <strong>{ledger.balance.toLocaleString('vi-VN')} lượt</strong></span>
              <button className="adm-btn-primary adm-btn-sm" type="button" disabled={!courses.length}
                title={courses.length ? undefined : 'Không có khoá nào còn hiệu lực để điều chỉnh.'}
                onClick={() => { setDraft(adjustDraft(courses) as Draft); setConfirm(null); }}>Điều chỉnh lượt</button>
            </div>
            {cards.length ? (
              <ul className="cr-cards">
                {cards.map((card) => (
                  <li key={card.key} className={`cr-card is-${card.state}`}>
                    <strong>{card.title}</strong>
                    <span className="cr-card__state">{card.stateText}{card.expires ? ` · hạn ${card.expires}` : ''}</span>
                    {card.balance === null
                      ? <span className="cr-card__none">Không có sổ lượt (học bằng mã lớp cũ)</span>
                      : <span className="cr-card__balance">{card.balance.toLocaleString('vi-VN')} lượt</span>}
                    {card.carryText ? <span className="cr-card__carry">{card.carryText}</span> : null}
                    {card.usableFrom ? <span className="cr-card__carry">dùng được từ {card.usableFrom}</span> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="cr-empty">Người này chưa có khoá nào.</p>}
          </section>

          <section className="cr-history" aria-labelledby="cr-history-title">
            <h2 id="cr-history-title">Lịch sử lượt</h2>
            {rows.length ? (
              <div className="cr-table-scroll">
                <table className="cr-table">
                  <thead>
                    <tr>
                      <th scope="col">Thời gian</th>
                      <th scope="col">Việc</th>
                      <th scope="col">Khoá</th>
                      <th scope="col">Số lượt</th>
                      <th scope="col">Sau dòng này</th>
                      <th scope="col">Người làm · lý do</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.at}</td>
                        <td>{row.label}{row.detail ? <div className="cr-sub">{row.detail}</div> : null}</td>
                        <td>{row.course}</td>
                        <td className={row.positive ? 'is-plus' : 'is-minus'}>{row.delta}</td>
                        <td>{row.balanceAfter}</td>
                        <td>{[row.actor, row.note].filter(Boolean).join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="cr-empty">Sổ lượt chưa có dòng nào.</p>}
            {ledger.nextCursor ? (
              <button className="adm-btn-secondary adm-btn-sm" type="button" disabled={moreBusy} onClick={() => void more()}>
                {moreBusy ? 'Đang tải…' : 'Tải thêm'}
              </button>
            ) : null}
          </section>
        </>
      ) : null}

      <Dialog
        open={Boolean(draft) && !confirm}
        title="Điều chỉnh lượt"
        description="Ghi một dòng cộng hoặc trừ vào sổ lượt của một khoá còn hiệu lực."
        busy={busy}
        onClose={() => setDraft(null)}
        actions={<>
          <button className="adm-btn-secondary" type="button" onClick={() => setDraft(null)}>Huỷ</button>
          <button className="adm-btn-primary" type="submit" form="cr-adjust-form">Tiếp tục</button>
        </>}
      >
        <form id="cr-adjust-form" className="acd-form" onSubmit={review}>
          <Field label="Khoá">
            <select value={draft?.entitlementId || ''} onChange={(e) => draft && setDraft({ ...draft, entitlementId: e.target.value, error: '' })}>
              <option value="">Chọn khoá…</option>
              {courses.map((c) => <option key={c.key} value={c.entitlementId ?? ''}>{c.title} · còn {c.balance} lượt</option>)}
            </select>
          </Field>
          <fieldset className="cr-direction">
            <legend>Cộng hay trừ</legend>
            <label><input type="radio" name="cr-direction" checked={draft?.direction !== 'subtract'}
              onChange={() => draft && setDraft({ ...draft, direction: 'add', error: '' })} /> Cộng</label>
            <label><input type="radio" name="cr-direction" checked={draft?.direction === 'subtract'}
              onChange={() => draft && setDraft({ ...draft, direction: 'subtract', error: '' })} /> Trừ</label>
          </fieldset>
          <Field label="Số lượt">
            <input inputMode="numeric" value={draft?.amount || ''} onChange={(e) => draft && setDraft({ ...draft, amount: e.target.value, error: '' })} />
          </Field>
          <Field label="Lý do" hint={`Ít nhất ${REASON_MIN} ký tự. Học viên thấy lý do này trong lịch sử lượt của mình.`}>
            <textarea maxLength={REASON_MAX} rows={3} value={draft?.reason || ''}
              onChange={(e) => draft && setDraft({ ...draft, reason: e.target.value, error: '' })} />
          </Field>
          {draft?.error ? <div className="acd-inline-error" role="alert">{draft.error}</div> : null}
        </form>
      </Dialog>

      <Dialog
        open={Boolean(confirm)}
        title="Xác nhận điều chỉnh"
        busy={busy}
        onClose={() => { if (!busy) setConfirm(null); }}
        actions={<>
          <button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setConfirm(null)}>Quay lại</button>
          <button className="adm-btn-primary" type="button" disabled={busy} onClick={() => void submit()}>{busy ? 'Đang ghi…' : 'Xác nhận'}</button>
        </>}
      >
        <p>{confirm?.text}</p>
        {confirmError ? <div className="acd-inline-error" role="alert">{confirmError}</div> : null}
      </Dialog>
    </main>
  );
}
