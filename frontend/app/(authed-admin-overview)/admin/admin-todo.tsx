'use client';

// Việc cần làm (ADMINIA-0074 FR-090…093; sheet AdminViecCanLam; G09-T18 part B).
// One read of GET /admin/attention (G09-T06). Each queue row has its own
// state: a failed source turns only that row into a warning with "chưa có"
// and its own reload; a count is never replaced by 0. Links appear only for
// pages that are live.
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  dayText,
  hoursText,
  lessonText,
  liveHref,
  normalizeAttention,
  percentText,
  summaryText,
  timeText,
  visibleRows,
  waitedText,
  type Attention,
  type QueueKey,
  type QueueRowDef,
} from '@/lib/admin-todo-model.mjs';

type Load = { kind: 'loading' } | { kind: 'error'; at: Date } | { kind: 'ready'; data: Attention; at: Date };

async function readAttention(): Promise<Attention | null> {
  return normalizeAttention(await window.api.getWith<unknown>('/admin/attention'));
}

export function AdminTodo() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [rowTried, setRowTried] = useState<Partial<Record<QueueKey, Date>>>({});
  const [rowBusy, setRowBusy] = useState<Partial<Record<QueueKey, true>>>({});
  /** The page snapshot: a full read bumps it, and every older answer is dropped. */
  const sequence = useRef(0);
  /** Per row: only the newest "Tải lại dòng này" of that row may write it. */
  const rowRequest = useRef<Partial<Record<QueueKey, number>>>({});
  const rowCounter = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    // A full read makes every row retry still in flight stale.
    rowRequest.current = {};
    setRowBusy({});
    try {
      const data = await readAttention();
      if (id !== sequence.current) return;
      if (data) setLoad({ kind: 'ready', data, at: new Date() });
      else { console.warn('[admin-todo] foreign shape'); setLoad({ kind: 'error', at: new Date() }); }
    } catch (caught) {
      if (id !== sequence.current) return;
      console.warn('[admin-todo] load failed', caught);
      setLoad({ kind: 'error', at: new Date() });
    }
    setRowTried({});
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /**
   * "Tải lại dòng này": reads again and takes only that row from the answer.
   * The answer is dropped when a full read started after it (the snapshot
   * moved) or a newer retry of the same row did.
   */
  const reloadRow = async (key: QueueKey) => {
    const snapshot = sequence.current;
    const request = ++rowCounter.current;
    rowRequest.current = { ...rowRequest.current, [key]: request };
    const current = () => snapshot === sequence.current && rowRequest.current[key] === request;
    setRowBusy((prev) => ({ ...prev, [key]: true }));
    let fresh: Attention | null = null;
    try {
      fresh = await readAttention();
    } catch (caught) {
      if (current()) console.warn('[admin-todo] row reload failed', key, caught);
    }
    if (!current()) return;
    if (fresh) {
      const row = fresh.queues[key];
      setLoad((prev) => (prev.kind === 'ready'
        ? { ...prev, data: { ...prev.data, queues: { ...prev.data.queues, [key]: row } } }
        : prev));
    }
    setRowTried((prev) => ({ ...prev, [key]: new Date() }));
    setRowBusy((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  const now = new Date();
  return (
    <main className="todo-shell">
      <header className="todo-header">
        <div>
          <h1>Việc cần làm</h1>
          <p className="subtitle">
            {dayText(now)}
            {load.kind === 'ready' ? ` · cập nhật lúc ${timeText(load.at)} · ${summaryText(load.data)}` : null}
            {load.kind === 'ready' && !load.data.thresholdsFailed ? '. Việc vượt ngưỡng ở Cài đặt › Ngưỡng vận hành được tô màu đánh dấu.' : null}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => void refresh()}>Làm mới</button>
      </header>

      {load.kind === 'loading' ? <p className="todo-muted" role="status">Đang tải việc cần làm…</p> : null}
      {load.kind === 'error' ? (
        <div className="todo-error" role="alert">
          <h2>Chưa tải được việc cần làm</h2>
          <p>Lần thử cuối {timeText(load.at)}. Các trang hàng chờ vẫn mở được trực tiếp từ thanh bên.</p>
          <button type="button" className="btn-secondary" onClick={() => void refresh()}>Tải lại</button>
        </div>
      ) : null}
      {load.kind === 'ready' ? (
        <>
          {load.data.thresholdsFailed ? (
            <p className="todo-warning" role="note">Chưa đọc được ngưỡng vận hành, nên chưa tô các dòng quá hạn.</p>
          ) : null}
          <QueueTable data={load.data} at={load.at} tried={rowTried} busy={rowBusy} onReload={reloadRow} now={now} />
          <ClassesWeek data={load.data} now={now} />
          <AttentionLearners data={load.data} />
          <OpsWeek data={load.data} />
          <p className="todo-foot">
            Công tắc chọn model AI không nằm ở trang này
            {liveHref('/admin/ai-models') ? <>: vào <a href="/admin/ai-models">Hệ thống › AI và mô hình</a>.</> : '.'}
          </p>
        </>
      ) : null}
    </main>
  );
}

function QueueTable({ data, at, tried, busy, onReload, now }: {
  data: Attention; at: Date; tried: Partial<Record<QueueKey, Date>>; busy: Partial<Record<QueueKey, true>>;
  onReload: (key: QueueKey) => void; now: Date;
}) {
  const rows = visibleRows(data);
  const empty = rows.every((r) => data.queues[r.key].state === 'ok' && data.queues[r.key].count === 0);
  return (
    <section className="todo-block" aria-labelledby="todo-queues">
      <h2 id="todo-queues" className="todo-visually-hidden">Hàng chờ</h2>
      {empty ? (
        <div className="todo-calm">
          <p className="todo-calm-title">Không còn việc nào đang chờ</p>
          <p>Việc mới sẽ hiện ở đây ngay khi có.</p>
        </div>
      ) : null}
      <div className="todo-table-wrap">
        <table className="todo-table">
          <thead>
            <tr><th scope="col">Việc</th><th scope="col">Đang chờ</th><th scope="col">Việc cũ nhất đã chờ</th><th scope="col">Lối vào</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <QueueRow key={row.key} row={row} data={data} at={tried[row.key] ?? at} busy={busy[row.key] === true} onReload={onReload} now={now} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function QueueRow({ row, data, at, busy, onReload, now }: {
  row: QueueRowDef; data: Attention; at: Date; busy: boolean; onReload: (key: QueueKey) => void; now: Date;
}) {
  const q = data.queues[row.key];
  const href = liveHref(row.href);
  const entry = href ? <a href={href}>Mở {row.label}</a> : null;
  if (q.state === 'error') {
    return (
      <tr className="is-warning">
        <th scope="row">
          <span className="todo-flag">Cảnh báo</span> {row.label}
          <span className="todo-row-note">Chưa tải được số này. Các dòng khác vẫn đúng.</span>
        </th>
        <td>chưa có</td>
        <td>Lần thử cuối {timeText(at)}</td>
        <td className="todo-entry">
          <button type="button" className="todo-link-button" disabled={busy} onClick={() => onReload(row.key)}>
            {busy ? 'Đang tải lại…' : 'Tải lại dòng này'}
          </button>
          {entry}
        </td>
      </tr>
    );
  }
  if (q.state === 'unavailable') {
    return (
      <tr className="is-muted">
        <th scope="row">{row.label}</th>
        <td>chưa có</td>
        <td>chưa có trên hệ thống</td>
        <td className="todo-entry">{entry}</td>
      </tr>
    );
  }
  const none = q.count === 0;
  const waited = waitedText(q.oldestAt, now);
  let shown: string = none ? 'Không có' : (q.count ?? 0).toLocaleString('vi-VN');
  if (row.key === 'writing_review' && !none) {
    shown = `Writing ${shown} · AI lỗi cần chấm tay ${q.aiFailed == null ? 'chưa có' : q.aiFailed.toLocaleString('vi-VN')}`;
  }
  const overdue = q.overdue && !data.thresholdsFailed;
  return (
    <tr className={none ? 'is-muted' : overdue ? 'is-overdue' : undefined}>
      <th scope="row">{row.label}</th>
      <td>{shown}</td>
      <td>{none ? 'không có việc chờ' : waited ? `${waited}${overdue ? ' · quá hạn' : ''}` : 'chưa có'}</td>
      <td className="todo-entry">{entry}</td>
    </tr>
  );
}

function Missing({ title, onAgainLabel }: { title: string; onAgainLabel?: string }) {
  return (
    <p className="todo-missing"><strong>chưa có</strong> · {title}{onAgainLabel ? ` ${onAgainLabel}` : ''}</p>
  );
}

function ClassesWeek({ data, now }: { data: Attention; now: Date }) {
  const classesHref = liveHref('/admin/classes');
  const list = data.classes;
  return (
    <section className="todo-block" aria-labelledby="todo-classes">
      <div className="todo-block-head">
        <h2 id="todo-classes">Lớp hôm nay và tuần này{list ? ` · buổi sắp tới của ${list.length} lớp` : ''}</h2>
        {classesHref ? <a href={classesHref}>Mở danh sách lớp</a> : null}
      </div>
      {list == null ? <Missing title="chưa đọc được buổi học của các lớp. Bấm Làm mới để thử lại." /> : null}
      {list && !list.length ? <p className="todo-muted">Không lớp nào có buổi học trong 7 ngày tới.</p> : null}
      {list && list.length ? (
        <div className="todo-table-wrap">
          <table className="todo-table">
            <thead>
              <tr><th scope="col">Lớp</th><th scope="col">Buổi</th><th scope="col">Bài giao buổi này</th><th scope="col">Chờ duyệt, cần xong trước buổi</th><th scope="col">Lối vào</th></tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const classHref = liveHref(`/admin/classes/${encodeURIComponent(c.id)}`);
                return (
                  <tr key={c.id}>
                    <th scope="row">{c.name ? `Lớp ${c.name}` : 'Lớp chưa đặt tên'}</th>
                    <td>
                      {lessonText(c.next, now)}
                      {c.following ? <span className="todo-row-note">Sau đó: {lessonText(c.following, now)}</span> : null}
                    </td>
                    <td className={c.hasAssignment ? undefined : 'is-flag'}>{c.hasAssignment ? 'Đã giao' : 'Chưa có bài giao'}</td>
                    <td className={c.pendingReview ? 'is-flag' : undefined}>{c.pendingReview ? `${c.pendingReview} bài` : 'Không có'}</td>
                    <td className="todo-entry">
                      {classHref ? <a href={classHref}>Mở lớp</a> : null}
                      {/* FR-091: "Giao bài…" lives in the class's Bài tập tab ("Giao bài lớp"). */}
                      {classHref ? <a href={`${classHref}?tab=homework`}>Giao bài…</a> : null}
                      {classHref && c.lastAssignmentId
                        ? <a href={`${classHref}?tab=homework&assignment_id=${encodeURIComponent(c.lastAssignmentId)}`}>Xem kết quả bài giao</a>
                        : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function AttentionLearners({ data }: { data: Attention }) {
  const list = data.learners;
  return (
    <section className="todo-block" aria-labelledby="todo-attention">
      <div className="todo-block-head">
        <h2 id="todo-attention">Cần chú ý tuần này{list ? ` · ${list.length} học viên` : ''}</h2>
      </div>
      <p className="todo-muted">Một học viên nhiều lý do thì hiện một dòng, ghi đủ lý do. Tối đa 8 người, xếp theo số lý do rồi theo tên.</p>
      {list == null ? <Missing title="chưa đọc được danh sách cần chú ý. Bấm Làm mới để thử lại." /> : null}
      {list && !list.length ? <p className="todo-muted">Tuần này không có học viên nào cần chú ý.</p> : null}
      {list && list.length ? (
        <div className="todo-table-wrap">
          <table className="todo-table">
            <thead><tr><th scope="col">Học viên</th><th scope="col">Lý do</th><th scope="col">Lối vào</th></tr></thead>
            <tbody>
              {list.map((l) => {
                const profile = liveHref(`/admin/learners/${encodeURIComponent(l.ref)}`);
                return (
                  <tr key={l.ref}>
                    <th scope="row">
                      {l.name}
                      {l.cohort?.name ? <span className="todo-row-note">Lớp {l.cohort.name}</span> : null}
                    </th>
                    <td>{l.reasons.length ? l.reasons.join(' · ') : 'chưa có'}</td>
                    <td className="todo-entry">{profile ? <a href={profile}>Mở hồ sơ</a> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function OpsWeek({ data }: { data: Attention }) {
  const { ops } = data;
  const lowest = ops.lowestCohortId ? liveHref(`/admin/classes/${encodeURIComponent(ops.lowestCohortId)}`) : null;
  const queue = liveHref('/admin/writing/queue');
  const reports = liveHref('/admin/reports?tab=hoat-dong');
  return (
    <section className="todo-block" aria-labelledby="todo-ops">
      <div className="todo-block-head">
        <h2 id="todo-ops">Vận hành tuần này · 7 ngày qua</h2>
        {reports ? <a href={reports}>Xem đầy đủ trong Báo cáo › Hoạt động học viên</a> : null}
      </div>
      <div className="todo-tiles">
        <div className="todo-tile">
          <p className="todo-tile-label">Nộp đúng hạn</p>
          <p className={ops.onTimeRate == null ? 'todo-tile-value is-missing' : 'todo-tile-value'}>{ops.onTimeRate == null ? 'chưa có' : percentText(ops.onTimeRate)}</p>
          <p className="todo-tile-note">bài giao có hạn trong tuần, nộp trước hạn</p>
          {lowest ? <a href={lowest}>Mở lớp có tỉ lệ thấp nhất ›</a> : null}
        </div>
        <div className="todo-tile">
          <p className="todo-tile-label">Còn quyền nhưng không hoạt động 7 ngày</p>
          <p className={ops.inactiveLearners == null ? 'todo-tile-value is-missing' : 'todo-tile-value'}>{ops.inactiveLearners == null ? 'chưa có' : `${ops.inactiveLearners.toLocaleString('vi-VN')} học viên`}</p>
          <p className="todo-tile-note">không có phiên học nào trong 7 ngày</p>
        </div>
        <div className="todo-tile">
          <p className="todo-tile-label">Trung vị thời gian chờ duyệt</p>
          <p className={ops.reviewWaitHours == null ? 'todo-tile-value is-missing' : 'todo-tile-value'}>{ops.reviewWaitHours == null ? 'chưa có' : `${hoursText(ops.reviewWaitHours)} giờ`}</p>
          <p className="todo-tile-note">Writing của lớp offline, từ lúc AI chấm xong tới lúc trả</p>
          {queue ? <a href={queue}>Mở hàng chờ duyệt ›</a> : null}
        </div>
      </div>
    </section>
  );
}

