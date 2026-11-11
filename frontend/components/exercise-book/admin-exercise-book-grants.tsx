'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Dialog, Field, StatusBanner } from '@/components/admin-directory-ui';
import { useAuth } from '@/lib/auth/auth-provider';
import { useExerciseBookApi } from '@/lib/exercise-book/api-context';
import type { ErrorCode, Grant, GrantAction, GrantEventCreate, GrantList, GrantLogEntry, GrantRole } from '@/lib/exercise-book/contract';
import { codeText, errorCode, errorText, formatVnTime, isUuid } from '@/lib/exercise-book/model';

const ROLE_LABEL: Record<GrantRole, string> = { assigner: 'Giao bài', teacher: 'Xem và chữa bài' };
const ACTION_LABEL: Record<GrantAction, string> = { grant: 'Cấp quyền', revoke: 'Thu quyền' };
const MAX_REASON = 1000;

type Draft = Omit<GrantEventCreate, 'request_id'>;
type Banner = { kind: 'success' | 'error'; text: string } | null;

function gateText(code: ErrorCode) {
  if (code === 'forbidden' || code === 'not_owner') return 'Chỉ tài khoản được ủy quyền cho course 2 mới dùng được trang này.';
  if (code === 'not_found') return 'Trang cấp quyền chỉ dùng cho lớp thuộc course 2.';
  return codeText(code);
}

function mutationText(caught: unknown) {
  const code = errorCode(caught);
  if (code === 'conflict') return 'Người này đã ở đúng trạng thái đó, hoặc yêu cầu bị trùng. Danh sách đã được tải lại.';
  if (code === 'validation') return 'Không cấp được: lý do không được để trống và không tự cấp quyền cho chính mình.';
  if (code === 'network') return 'Chưa xác nhận được thao tác. Bấm xác nhận lần nữa sẽ gửi lại cùng mã yêu cầu, không ghi trùng.';
  return errorText(caught);
}

/**
 * Course-2 grant/revoke page (CV-1). This is a UI gate only: the page renders
 * its controls only after the server answered 200 for this account; every
 * write is enforced server-side (owner UUID, AAL2 step-up, 377 trigger).
 */
export function AdminExerciseBookGrants({ cohortId }: { cohortId: string }) {
  const { user } = useAuth();
  return <GrantsSession key={`${user?.id || ''}:${cohortId}`} cohortId={cohortId} actorId={user?.id || null} />;
}

function GrantsSession({ cohortId, actorId }: { cohortId: string; actorId: string | null }) {
  const api = useExerciseBookApi();
  const [list, setList] = useState<GrantList | null>(null);
  const [gate, setGate] = useState<ErrorCode | null>(null);
  const [log, setLog] = useState<GrantLogEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [logError, setLogError] = useState('');
  const [banner, setBanner] = useState<Banner>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const loadGrants = useCallback(async () => {
    try {
      setList(await api.getGrants(cohortId));
      setGate(null);
    } catch (caught) {
      setList(null);
      setGate(errorCode(caught));
    }
  }, [api, cohortId]);

  const loadLog = useCallback(async (next: string | null) => {
    setLogError('');
    try {
      const page = await api.getGrantLog(cohortId, { cursor: next });
      setLog((current) => (next && current ? [...current, ...page.items] : page.items));
      setCursor(page.next_cursor);
    } catch (caught) {
      setLogError(errorText(caught));
    }
  }, [api, cohortId]);

  useEffect(() => { void loadGrants(); }, [loadGrants]);
  useEffect(() => { if (list) void loadLog(null); }, [list, loadLog]);

  const names = useMemo(() => new Map((list?.grants || []).map((grant) => [grant.grantee_id, grant.display_name])), [list]);

  if (gate) {
    return (
      <section className="acd-state is-error" role="alert">
        <strong>Không mở được trang cấp quyền</strong>
        <span>{gateText(gate)}</span>
      </section>
    );
  }
  if (!list) return <div className="acd-state" role="status">Đang kiểm tra quyền…</div>;

  const refresh = async (text: string, kind: 'success' | 'error') => {
    setBanner({ kind, text });
    await loadGrants();
  };

  return (
    <div className="ach-workspace">
      <StatusBanner banner={banner} />
      <section aria-labelledby="exercise-book-grants-title">
        <div className="acx-section-head">
          <div>
            <h2 id="exercise-book-grants-title">Quyền sách bài tập của lớp</h2>
            <p>“Giao bài” cho phép tạo bài sách bài tập; “Xem và chữa bài” cho phép xem tiến độ và chữa bài. Mỗi thao tác được ghi vào nhật ký.</p>
          </div>
        </div>
        {!list.grants.length && <p>Chưa cấp quyền cho ai trong lớp này.</p>}
        {list.grants.length > 0 && (
          <div className="acd-table-scroll" role="region" tabIndex={0} aria-label="Danh sách quyền">
            <table className="acd-table">
              <thead><tr><th scope="col">Nhân sự</th><th scope="col">Quyền</th><th scope="col">Trạng thái</th><th scope="col">Lần đổi gần nhất</th><th scope="col"><span className="sr-only">Thao tác</span></th></tr></thead>
              <tbody>
                {list.grants.map((grant: Grant) => (
                  <tr key={`${grant.grantee_id}|${grant.role}`}>
                    <th scope="row">{grant.display_name}</th>
                    <td>{ROLE_LABEL[grant.role]}</td>
                    <td>{grant.state === 'granted' ? 'Đang có quyền' : 'Đã thu quyền'}</td>
                    <td>#{grant.last_event_seq} · {formatVnTime(grant.last_event_at)}</td>
                    <td>
                      <button className="adm-btn-secondary adm-btn-sm" type="button"
                        onClick={() => setDraft({ grantee_id: grant.grantee_id, role: grant.role, action: grant.state === 'granted' ? 'revoke' : 'grant', reason: '' })}>
                        {grant.state === 'granted' ? 'Thu quyền' : 'Cấp lại'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <NewGrantForm actorId={actorId} onReady={setDraft} />
      </section>
      <section aria-labelledby="exercise-book-grant-log-title">
        <div className="acx-section-head"><h2 id="exercise-book-grant-log-title">Nhật ký cấp/thu quyền</h2></div>
        {logError && (
          <div className="acd-warning" role="alert">
            <span>{logError}</span>
            <button className="adm-btn-secondary" type="button" onClick={() => void loadLog(null)}>Thử lại</button>
          </div>
        )}
        {log && !log.length && <p>Nhật ký chưa có sự kiện nào.</p>}
        {log && log.length > 0 && (
          <ol className="ach-log">
            {log.map((entry) => (
              <li className="ach-log-row" key={entry.event_id}>
                <strong>#{entry.seq} · {ACTION_LABEL[entry.action]} “{ROLE_LABEL[entry.role]}”</strong>
                <span> cho {names.get(entry.grantee_id) || 'nhân sự khác'} · bởi {entry.actor_id === actorId ? 'bạn' : 'tài khoản khác'} · {formatVnTime(entry.occurred_at)}</span>
                <p>Lý do: {entry.reason}</p>
              </li>
            ))}
          </ol>
        )}
        {cursor && <button className="adm-btn-secondary" type="button" onClick={() => void loadLog(cursor)}>Xem thêm</button>}
      </section>
      {draft && (
        <ConfirmGrant key={`${draft.grantee_id}|${draft.role}|${draft.action}`} cohortId={cohortId} draft={draft}
          name={names.get(draft.grantee_id) || null}
          onClose={() => setDraft(null)}
          onDone={async (text, kind) => { setDraft(null); await refresh(text, kind); }} />
      )}
    </div>
  );
}

function NewGrantForm({ actorId, onReady }: { actorId: string | null; onReady: (draft: Draft) => void }) {
  const [granteeId, setGranteeId] = useState('');
  const [role, setRole] = useState<GrantRole>('assigner');
  const [problem, setProblem] = useState('');
  function next() {
    const id = granteeId.trim().toLowerCase();
    if (!isUuid(id)) { setProblem('Nhập đúng mã tài khoản (UUID) của nhân sự.'); return; }
    if (actorId && id === actorId.toLowerCase()) { setProblem('Không tự cấp quyền cho chính mình.'); return; }
    setProblem('');
    onReady({ grantee_id: id, role, action: 'grant', reason: '' });
  }
  return (
    <form className="ach-form" onSubmit={(event) => { event.preventDefault(); next(); }} aria-label="Cấp quyền mới">
      <Field label="Mã tài khoản nhân sự (UUID)" hint="Lấy ở trang Người dùng của admin.">
        <input value={granteeId} autoComplete="off" spellCheck={false} onChange={(event) => setGranteeId(event.target.value)} />
      </Field>
      <Field label="Quyền">
        <select value={role} onChange={(event) => setRole(event.target.value as GrantRole)}>
          <option value="assigner">{ROLE_LABEL.assigner}</option>
          <option value="teacher">{ROLE_LABEL.teacher}</option>
        </select>
      </Field>
      {problem && <p role="alert">{problem}</p>}
      <button className="adm-btn-primary" type="submit">Tiếp tục</button>
    </form>
  );
}

function ConfirmGrant({ cohortId, draft, name, onClose, onDone }: {
  cohortId: string;
  draft: Draft;
  name: string | null;
  onClose: () => void;
  onDone: (text: string, kind: 'success' | 'error') => Promise<void>;
}) {
  const api = useExerciseBookApi();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Same body → same request_id: a retry after a lost ACK is a replay, not a second event.
  const request = useRef<{ fingerprint: string; id: string } | null>(null);

  async function confirm() {
    const text = reason.trim();
    if (!text || text.length > MAX_REASON) { setError(`Nhập lý do (1–${MAX_REASON} ký tự).`); return; }
    const body: Draft = { ...draft, reason: text };
    const fingerprint = JSON.stringify(body);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      await api.recordGrant(cohortId, { ...body, request_id: request.current.id });
      await onDone(`${ACTION_LABEL[draft.action]} “${ROLE_LABEL[draft.role]}” đã được ghi vào nhật ký.`, 'success');
    } catch (caught) {
      const code = errorCode(caught);
      if (code === 'conflict' || code === 'idempotency_conflict') {
        await onDone(mutationText(caught), 'error');
        return;
      }
      if (code !== 'network') request.current = null;
      setError(mutationText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={`${ACTION_LABEL[draft.action]} “${ROLE_LABEL[draft.role]}”`} busy={busy} onClose={onClose}
      description={<>Cho {name || 'tài khoản mới nhập'}. Thao tác cần xác thực MFA gần đây và được ghi vào nhật ký.</>}
      actions={(
        <>
          <button className="adm-btn-secondary" type="button" disabled={busy} onClick={onClose}>Huỷ</button>
          <button className="adm-btn-primary" type="button" disabled={busy} onClick={() => void confirm()}>{busy ? 'Đang ghi…' : 'Xác nhận'}</button>
        </>
      )}>
      <Field label={`Lý do (bắt buộc, tối đa ${MAX_REASON} ký tự)`}>
        <textarea value={reason} maxLength={MAX_REASON} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
