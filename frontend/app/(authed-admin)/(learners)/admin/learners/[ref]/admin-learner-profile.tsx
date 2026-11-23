'use client';

// Hồ sơ học viên (ADMINIA-0074 FR-022…FR-024, FR-030, FR-031, FR-034; plan 5.4;
// G09-T11a). Header = the shared learner block; five tabs in the URL; Tổng quan
// from GET /admin/learners/{ref}/overview (G09-T04); role change and danger
// zone at the end of Khoá và quyền (G09-T11b, learner-access-tab.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import { messageOf, StatusBanner } from '@/components/admin-directory-ui';
import { liveHref } from '@/components/ui/shell/learner-sections';
import { LearnerSummary } from '@/components/admin/learner-summary';
import {
  getLearnerDetail,
  getLearnerOverview,
  resolveLearnerGoal,
  type LearnerDetailWire,
  type LearnerOverviewWire,
} from '@/lib/admin-learners-api';
import {
  PROFILE_TABS,
  TAB_PENDING,
  alertsView,
  assignedView,
  canonicalHref,
  continuityView,
  dueText,
  failedText,
  goalConfirmText,
  goalErrorText,
  goalSeen,
  goalView,
  notifyOneHref,
  parseTab,
  scoresView,
  sideView,
  tabHref,
} from '@/lib/admin-learner-profile-model.mjs';
import { NOTIFY_HANDOFF_KEY, notifyHandoff } from '@/lib/admin-learners-model.mjs';
import { assignmentHref } from '@/lib/admin-writing-assignments-model.mjs';

import { LearnerAccessTab } from './learner-access-tab';
import { PracticeGrantForm } from '@/components/admin/practice-grant-form';

type Banner = { kind: 'success' | 'error'; text: string } | null;

function Block({ title, failed, onReload, children }: {
  title: string; failed: boolean; onReload: () => void; children: React.ReactNode;
}) {
  return (
    <section className="lp-block" aria-label={title}>
      <h2>{title}</h2>
      {failed ? (
        <p className="la-warning" role="alert">
          Chưa đọc được khối này.{' '}
          <button type="button" className="adm-btn-secondary" onClick={onReload}>Tải lại</button>
        </p>
      ) : children}
    </section>
  );
}

export function AdminLearnerProfile({ learnerRef }: { learnerRef: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const query = search?.toString() ?? '';
  const tab = useMemo(() => parseTab(query), [query]);

  const [detail, setDetail] = useState<LearnerDetailWire | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [overview, setOverview] = useState<LearnerOverviewWire | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [pick, setPick] = useState<'admin' | 'learner' | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const admin = useAdminProfile();
  // FR-045: one learner's re-practice grant. The form reads the learner's G04
  // access itself and leaves out what they already hold.
  // The grant is tied to the admin/learner pair it was opened for (CR
  // 7102582818): another learner closes the form, and a late result of the
  // old run neither shows a banner nor reloads.
  const [grantFor, setGrantFor] = useState<{ pair: string; name: string } | null>(null);
  // Bumped after a grant so the "Khoá và quyền" tab reads access again (Codex).
  const [accessReload, setAccessReload] = useState(0);
  const overviewSeq = useRef(0);
  // Read through refs: the router object and the query are not stable across renders.
  const routerRef = useRef(router);
  routerRef.current = router;
  const queryRef = useRef(query);
  queryRef.current = query;

  const loadDetail = useCallback(async () => {
    setDetailError(null);
    try {
      const out = await getLearnerDetail(learnerRef);
      const canonical = canonicalHref(learnerRef, out.canonical_ref, queryRef.current);
      if (canonical) { routerRef.current.replace(canonical); return; }
      setDetail(out);
    } catch (caught) {
      console.warn('[admin-learner-profile] detail load failed', caught);
      setDetailError((caught as { status?: number })?.status === 404 ? 'Không tìm thấy học viên này.' : messageOf(caught));
    }
  }, [learnerRef]);

  const loadOverview = useCallback(async () => {
    const id = ++overviewSeq.current;
    setOverviewError(null);
    try {
      const out = await getLearnerOverview(learnerRef);
      if (id === overviewSeq.current) setOverview(out);
    } catch (caught) {
      if (id !== overviewSeq.current) return;
      console.warn('[admin-learner-profile] overview load failed', caught);
      setOverview(null);
      setOverviewError(messageOf(caught));
    }
  }, [learnerRef]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);
  const loaded = detail !== null;
  useEffect(() => { if (tab === 'tong-quan' && loaded) void loadOverview(); }, [tab, loaded, loadOverview]);

  const failed = new Set(overview?.sources_failed ?? []);
  const alerts = alertsView(overview?.alerts);
  const goal = goalView(overview?.goal);
  const continuity = continuityView(overview?.continuity);
  const assigned = assignedView(overview?.assigned);
  const scores = scoresView(overview?.scores);
  const side = sideView(overview?.side);

  const resolveGoal = async (use: 'admin' | 'learner') => {
    if (!overview?.goal) return;
    setBusy(true);
    try {
      const out = await resolveLearnerGoal(learnerRef, use, goalSeen(overview.goal));
      setBanner({ kind: 'success', text: 'Đã ghi mục tiêu vào cả hồ sơ lớp và trang Tài khoản. Nhật ký hệ thống có dòng mới.' });
      setOverview((prev) => (prev ? { ...prev, goal: out.goal } : prev));
      void loadDetail();
    } catch (caught) {
      setBanner({ kind: 'error', text: goalErrorText(caught) });
      // The write may have committed (5xx after commit): reload both.
      void loadOverview();
      void loadDetail();
    } finally {
      setBusy(false);
      setPick(null);
    }
  };

  const go = (next: string) => (e: React.MouseEvent) => { e.preventDefault(); router.push(tabHref(learnerRef, next)); };
  const remind = () => {
    try {
      window.sessionStorage.setItem(NOTIFY_HANDOFF_KEY, notifyHandoff([{ ref: learnerRef, name: detail?.summary.name ?? '' }]));
    } catch { /* the page still opens with the ref in the URL */ }
  };

  const pair = `${admin.id}:${learnerRef}:${detail?.account?.user_id ?? ''}`;
  const pairRef = useRef(pair);
  pairRef.current = pair;
  useEffect(() => { setGrantFor((g) => (g && g.pair !== pair ? null : g)); }, [pair]);

  const grantUsers = useMemo(
    () => (detail?.account?.user_id ? [{ id: detail.account.user_id, name: detail.summary.name }] : []),
    [detail?.account?.user_id, detail?.summary.name],
  );

  if (detailError) {
    return (
      <main className="la-shell lp-shell">
        <p><a href="/admin/learners">← Học viên</a></p>
        <div className="la-warning" role="alert">
          Chưa tải được hồ sơ: {detailError}{' '}
          <button type="button" className="adm-btn-secondary" onClick={() => void loadDetail()}>Tải lại</button>
        </div>
      </main>
    );
  }
  if (!detail) return <main className="la-shell lp-shell"><p className="la-empty" role="status">Đang tải…</p></main>;

  return (
    <main className="la-shell lp-shell">
      <p className="lp-crumb"><a href="/admin/learners">Học viên</a> › {detail.summary.name}</p>
      <LearnerSummary summary={detail.summary} sourcesFailed={detail.sources_failed} />
      <div className="lp-actions">
        <a className="adm-btn-secondary" href={tabHref(learnerRef, 'ghi-chu')} onClick={go('ghi-chu')}>Thêm ghi chú</a>
        {/* Hidden until the notifications page is live (GOI-11), so it never links to a 404. */}
        {liveHref({ href: '/admin/notifications', today: null })
          ? <a className="adm-btn-secondary" href={notifyOneHref(learnerRef)} onClick={remind}>Gửi nhắc</a>
          : null}
        <a className="adm-btn-secondary" href={assignmentHref({}, detail.student_id ? { studentId: detail.student_id } : {})}>Giao bài</a>
        {detail.account?.user_id ? (
          <button type="button" className="adm-btn-secondary" onClick={() => setGrantFor({ pair, name: detail.summary.name })}>Cấp quyền luyện lại</button>
        ) : (
          <button type="button" className="adm-btn-secondary" disabled title="Người này chưa có tài khoản đăng nhập">Cấp quyền luyện lại</button>
        )}
      </div>

      {grantFor && grantFor.pair === pair && grantUsers.length ? (
        <PracticeGrantForm
          open
          users={grantUsers}
          onClose={() => setGrantFor(null)}
          onGranted={() => {
            if (pairRef.current !== grantFor.pair) return;
            setBanner({ kind: 'success', text: `Đã cấp quyền luyện lại cho ${grantFor.name}.` });
            setAccessReload((n) => n + 1);
            void loadDetail();
          }}
        />
      ) : null}

      <nav className="lp-tabs" aria-label="Thẻ hồ sơ">
        {PROFILE_TABS.map((t) => (
          <a key={t.id} href={tabHref(learnerRef, t.id)} aria-current={tab === t.id ? 'page' : undefined}
            onClick={go(t.id)}>{t.label}</a>
        ))}
      </nav>

      <StatusBanner banner={banner} />

      {tab === 'khoa-va-quyen' ? (
        <LearnerAccessTab detail={detail} reloadKey={accessReload} onChanged={async (next) => { if (next) setBanner(next); await loadDetail(); }} />
      ) : tab !== 'tong-quan' ? (
        <section className="lp-pending" aria-label={PROFILE_TABS.find((t) => t.id === tab)?.label}>
          <p className="la-note" role="status">Chưa mở. {TAB_PENDING[tab]}</p>
        </section>
      ) : overviewError ? (
        <div className="la-warning" role="alert">
          Chưa tải được thẻ Tổng quan: {overviewError}{' '}
          <button type="button" className="adm-btn-secondary" onClick={() => void loadOverview()}>Tải lại</button>
        </div>
      ) : !overview ? (
        <p className="la-empty" role="status">Đang tải…</p>
      ) : (
        <div className="lp-overview">
          <div className="lp-main">
            {overview.sources_failed.length ? <p className="la-warning" role="status">{failedText(overview.sources_failed)}</p> : null}

            <Block title={`Cảnh báo đang mở${alerts ? ` · ${alerts.open.length}` : ''}`} failed={!alerts} onReload={() => void loadOverview()}>
              {alerts?.open.length ? (
                <ul className="lp-alerts">
                  {alerts.open.map((a) => <li key={a.code}><strong>{a.text}</strong> <span>{a.action}</span></li>)}
                </ul>
              ) : <p className="la-empty">Không có cảnh báo đang mở.</p>}
              {alerts?.undecided ? <p className="la-note">{alerts.undecided}</p> : null}
              {alerts?.off ? <p className="la-note">{alerts.off} Ngưỡng ở Cài đặt › Ngưỡng vận hành.</p> : null}
            </Block>

            <Block title="Mục tiêu và ngày thi" failed={!goal} onReload={() => void loadOverview()}>
              {goal ? (
                <>
                  {goal.conflict ? <p className="la-note">Hai nguồn đang lệch. Chọn một giá trị để hai nơi khớp nhau.</p> : null}
                  <table className="lp-table">
                    <thead><tr><th scope="col">Nguồn</th><th scope="col">Band mục tiêu</th><th scope="col">Ngày thi</th><th scope="col">Khoảng cách</th>{goal.conflict ? <th scope="col">Chọn</th> : null}</tr></thead>
                    <tbody>
                      {goal.rows.map((r) => (
                        <tr key={r.use}>
                          <th scope="row">{r.source}</th><td>{r.band}</td><td>{r.date}</td><td>{r.left || '—'}</td>
                          {goal.conflict ? (
                            <td><button type="button" className="adm-btn-secondary" disabled={busy} onClick={() => setPick(r.use)}>Dùng giá trị này</button></td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {pick ? (
                    <div className="lp-confirm" role="alertdialog" aria-modal="false" aria-labelledby="lp-goal-confirm">
                      <p id="lp-goal-confirm">{goalConfirmText(goal, pick)}</p>
                      <button type="button" className="adm-btn-primary" disabled={busy} onClick={() => void resolveGoal(pick)}>Lưu</button>
                      <button type="button" className="adm-btn-secondary" disabled={busy} onClick={() => setPick(null)}>Huỷ</button>
                    </div>
                  ) : null}
                  <p className="la-note">{goal.estimated}</p>
                </>
              ) : null}
            </Block>

            <Block title="Độ liên tục · 8 tuần" failed={!continuity} onReload={() => void loadOverview()}>
              {continuity ? (
                <>
                  <table className="lp-grid" aria-label={`Ngày có học: ${continuity.activeDays} trong ${continuity.pastDays} ngày`}>
                    <thead><tr>{continuity.weekdays.map((d) => <th key={d} scope="col">{d}</th>)}</tr></thead>
                    <tbody>
                      {continuity.weeks.map((w, i) => (
                        <tr key={i}>
                          {w.cells.map((c, j) => (
                            <td key={j} className={`is-${c}`}
                              aria-label={c === 'on' ? 'có học' : c === 'off' ? 'không học' : 'chưa tới'} />
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p>{continuity.streak} Ngày có học: {continuity.activeDays} trong {continuity.pastDays} ngày.</p>
                  <p>{continuity.minutes}</p>
                </>
              ) : null}
            </Block>

            <Block title="Bài được giao" failed={!assigned} onReload={() => void loadOverview()}>
              {assigned ? (
                <>
                  <ul className="lp-counts">
                    {assigned.counts.map((c) => <li key={c.label}><strong>{c.value}</strong> {c.label}</li>)}
                  </ul>
                  {assigned.undecided ? <p className="la-note">{assigned.undecided}</p> : null}
                  {assigned.overdue.length ? (
                    <>
                      <h3>Quá hạn chưa nộp</h3>
                      <ul>{assigned.overdue.map((o) => <li key={o.assignment_id}>{o.title} · quá {o.days_overdue} ngày</li>)}</ul>
                    </>
                  ) : null}
                  <h3>Bài đang mở</h3>
                  {assigned.open.length
                    ? <ul>{assigned.open.map((o) => <li key={o.assignment_id}>{o.title} · {dueText(o.due_at)}</li>)}</ul>
                    : <p className="la-empty">Không có bài đang mở.</p>}
                </>
              ) : null}
            </Block>

            <Block title="Điểm theo thời gian" failed={!scores} onReload={() => void loadOverview()}>
              {scores ? (
                <>
                  <dl className="lp-scores">
                    {scores.series.map((s) => <div key={s.label}><dt>{s.label}</dt><dd>{s.points}</dd></div>)}
                  </dl>
                  {scores.milestones ? <p className="la-note">{scores.milestones}</p> : null}
                </>
              ) : null}
            </Block>
          </div>

          <aside className="lp-side" aria-label="Cột phải">
            <section className="lp-block">
              <h2>Việc đã hẹn</h2>
              {side.dueNotes ? <p className="la-note">{side.dueNotes}</p> : null}
              {side.notes.length ? <ul>{side.notes.map((n, i) => <li key={i}>{n.body ?? ''}</li>)}</ul> : null}
            </section>
            <section className="lp-block">
              <h2>Khoá và hạn</h2>
              <p>{side.courses}</p>
            </section>
            <section className="lp-block">
              <h2>Lượt chấm còn</h2>
              <p>{side.credits}</p>
              {side.carried ? <p className="la-note">{side.carried}</p> : null}
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}
