'use client';

// One incident group (ADMINIA-0074 FR-071…FR-072; plan 5.4; G09-T16).
import { useCallback, useEffect, useState } from 'react';

import {
  fetchIncidentGroup,
  postIncidentBulk,
  type IncidentAction,
  type IncidentGroupDetail,
} from '@/lib/admin-incidents-api';
import {
  ACTION_LABEL,
  REVIEW_QUEUE_HREF,
  SOURCE_LABEL,
  STATUS_LABEL,
  actionsFor,
  bulkRefs,
  bulkResultText,
  formatCount,
  formatWhen,
  learnerHref,
} from '@/lib/admin-incidents-model.mjs';

type Banner = { kind: 'success' | 'error'; text: string } | null;

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : 'lỗi không xác định';
}

export function AdminIncidentDetail({ source, fingerprint }: { source: string; fingerprint: string }) {
  const [group, setGroup] = useState<IncidentGroupDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setGroup(await fetchIncidentGroup(source, fingerprint));
    } catch (caught) {
      console.warn('[admin-incidents] detail load failed', caught);
      setLoadError((caught as { status?: number })?.status === 404 ? 'Không tìm thấy nhóm sự cố này.' : messageOf(caught));
    }
  }, [source, fingerprint]);

  useEffect(() => { void load(); }, [load]);

  const act = async (action: IncidentAction) => {
    if (!group) return;
    const body = note.trim();
    setBusy(true);
    try {
      const out = await postIncidentBulk(action, bulkRefs([group]), body || undefined);
      setBanner({
        kind: out.conflicts.length ? 'error' : 'success',
        text: bulkResultText(action, out),
      });
      if (!out.conflicts.length) setNote('');
      await load();
    } catch (caught) {
      setBanner({ kind: 'error', text: `Chưa thực hiện được: ${messageOf(caught)}` });
    } finally {
      setBusy(false);
    }
  };

  const back = `/admin/incidents?source=${encodeURIComponent(source)}`;
  if (loadError) {
    return (
      <main className="inc-shell">
        <p><a href={back}>← Hộp thư sự cố</a></p>
        <div className="inc-warning" role="alert">
          Chưa tải được nhóm sự cố: {loadError}{' '}
          <button type="button" onClick={() => void load()}>Tải lại</button>
        </div>
      </main>
    );
  }
  if (!group) return <main className="inc-shell"><p className="inc-empty">Đang tải…</p></main>;

  return (
    <main className="inc-shell">
      <p><a href={back}>← Hộp thư sự cố</a></p>
      <header className="inc-header">
        <h1>{group.title}</h1>
        <p className="subtitle">
          {SOURCE_LABEL[group.source]}{group.area ? ` · ${group.area}` : ''} ·{' '}
          <span className={`inc-chip is-${group.status}`}>{STATUS_LABEL[group.status]}</span>
          {group.overdue ? <span className="inc-chip is-overdue">Quá hạn</span> : null}
        </p>
      </header>

      <p className="inc-description">{group.description}</p>
      {group.source === 'feedback' ? (
        <p className="inc-note">Trả lời học viên ở <a href={REVIEW_QUEUE_HREF}>trang Phản hồi</a>; ở đây chỉ đổi trạng thái nhóm.</p>
      ) : null}
      <dl className="inc-facts">
        <div><dt>Số lần</dt><dd>{formatCount(group.count)}</dd></div>
        <div><dt>Học viên bị ảnh hưởng</dt><dd>{formatCount(group.learners)}</dd></div>
        <div><dt>Lần đầu</dt><dd>{formatWhen(group.first_at)}</dd></div>
        <div><dt>Lần cuối</dt><dd>{formatWhen(group.last_at)}</dd></div>
        {group.claimed_by_name ? <div><dt>Người nhận</dt><dd>{group.claimed_by_name}</dd></div> : null}
      </dl>

      {banner ? <div className={`inc-banner is-${banner.kind}`} role="status">{banner.text}</div> : null}

      <section className="inc-actions" aria-label="Xử lý nhóm">
        <label htmlFor="inc-note">Ghi chú kèm thao tác (không bắt buộc)</label>
        <textarea id="inc-note" maxLength={2000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="inc-buttons">
          {actionsFor(group.status).map((action) => (
            <button key={action} type="button" disabled={busy} onClick={() => void act(action)}>{ACTION_LABEL[action]}</button>
          ))}
        </div>
      </section>

      <section aria-labelledby="inc-learners">
        <h2 id="inc-learners">Học viên bị ảnh hưởng</h2>
        {group.learner_list.length ? (
          <ul className="inc-learners">
            {group.learner_list.map((p) => <li key={p.ref}><a href={learnerHref(p.ref)}>{p.name}</a></li>)}
          </ul>
        ) : <p className="inc-empty">Không có học viên nào gắn với nhóm này.</p>}
        {group.learners > group.learner_list.length ? (
          <p className="inc-note">Hiện {formatCount(group.learner_list.length)} / {formatCount(group.learners)} học viên.</p>
        ) : null}
      </section>

      <section aria-labelledby="inc-notes">
        <h2 id="inc-notes">Ghi chú</h2>
        {group.notes.length ? (
          <ol className="inc-notes">
            {group.notes.map((n, i) => (
              <li key={i} className={n.auto ? 'is-auto' : undefined}>
                <span className="inc-area">{formatWhen(n.created_at ?? null)} · {n.auto ? 'Hệ thống' : (n.actor_name || 'Quản trị viên')}</span>
                <p>{n.body}</p>
              </li>
            ))}
          </ol>
        ) : <p className="inc-empty">Chưa có ghi chú.</p>}
      </section>

      <details className="inc-technical">
        <summary>Chi tiết kỹ thuật</summary>
        <pre>{JSON.stringify(group.technical, null, 2)}</pre>
      </details>
    </main>
  );
}
