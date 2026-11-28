'use client';

// /account (LEARNERCORE-0063 FR-060, FR-087; sheet TaiKhoan).
//
// - Two groups, "Khoá online" and "Khoá của lớp", from G04's
//   `GET /api/me/courses` (active first, fewest days left first, then expired).
//   A class course says "mã do admin cấp" and never offers "Đăng ký lại".
// - "Lượt chấm AI còn lại": one number shared by Writing and Speaking, split
//   by source (`credits.by_kind`). The history is `GET /api/me/credits`, newest
//   first, 20 rows a page with "Xem thêm"; the label is the server's
//   `label_vi` and the last column is the server's `balance_after`. No skill
//   column, no "50%", and the page never adds or subtracts credits itself.
// - G04 not there yet (404 or another shape): the class group comes from
//   `/api/class/me` and the online group says "Thông tin khoá online sẽ có khi
//   bạn đăng ký". No credit number is shown at all, never a 0.
// - ACCOUNTDATA-0100 (G04-T18, routes of #2600): the page first reads
//   `GET /api/account/deletion-request`. While a deletion is pending (or
//   erasing) every other learner route answers 403, so the page shows only the
//   notice with "Huỷ yêu cầu xoá" and the "Dữ liệu của tôi" block. Otherwise it
//   shows the usual blocks plus "Dữ liệu của tôi" and the danger zone. A 404
//   (routes not deployed) hides both blocks.
// - Every link goes through `liveHref`: a planned page is never linked.
import { useCallback, useEffect, useRef, useState } from 'react';

import { getBrowserJson } from '@/lib/browser-api';
import type { ApiGetJson, ApiGetPath } from '@/lib/openapi-contract';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageState } from '@/components/ui/page-state';
import { liveHref } from '@/components/ui/shell/learner-sections';
import { DataExportBlock, DeleteAccountZone, PendingDeletionNotice } from '@/components/learner/account-data';
import { useLearnerMe } from '@/components/learner/learner-frame';
import { normalizeDeletion, type DeletionView } from '@/lib/account-data-model.mjs';
import { useAuth } from '@/lib/auth/auth-provider';
import {
  carryLine,
  classMeIncomplete,
  classesFromClassMe,
  contentVisibleLine,
  courseTimeLine,
  creditSourceLines,
  formatDelta,
  formatVnDate,
  normalizeCreditPage,
  normalizeMyCourses,
  type CreditRow,
  type MyCourse,
  type MyCourses,
} from '@/lib/account-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import styles from './account.module.css';

type Read<Path extends ApiGetPath> = { ok: true; data: ApiGetJson<Path> } | { ok: false; status: number | null };
type ClassRow = ReturnType<typeof classesFromClassMe>[number];
/** `absent`: the ACCOUNTDATA-0100 routes answer 404 (not deployed). */
type DataRights = 'absent' | 'failed' | 'none';
type Phase =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'pending'; deletion: DeletionView }
  | { kind: 'ready'; courses: MyCourses | null; coursesFailed: boolean; classes: ClassRow[]; classesIncomplete: boolean; dataRights: DataRights };
type History =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: CreditRow[]; nextCursor: string | null; more: 'idle' | 'loading' | 'error' };

const ACTIVATE = liveHref({ href: '/activate', today: null });
const COURSES = liveHref({ href: '/courses', today: null });
const ORDERS = liveHref({ href: '/account/orders', today: null });
const PROGRESS = liveHref({ href: '/progress', today: null });

async function read<Path extends ApiGetPath>(path: Path, signal?: AbortSignal, query?: URLSearchParams): Promise<Read<Path>> {
  try {
    const data = await getBrowserJson(path, query, signal);
    return { ok: true, data };
  } catch (error) {
    const status = (error as { status?: unknown })?.status;
    return { ok: false, status: typeof status === 'number' ? status : null };
  }
}

function renewHref(course: MyCourse): string | null {
  if (course.renewOrderCode) {
    const order = liveHref({ href: `/enroll/${encodeURIComponent(course.renewOrderCode)}`, today: null });
    if (order) return order;
  }
  return COURSES;
}

function OnlineCourse({ course }: { course: MyCourse }) {
  const time = courseTimeLine(course);
  const carry = carryLine(course);
  const renew = course.canRenew ? renewHref(course) : null;
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <p className={styles.rowTitle}>{course.title}</p>
        <p className={styles.rowMeta}>
          {time ? <span>{time}</span> : null}
          {course.balance !== null ? <span>{course.balance} lượt chấm AI</span> : null}
        </p>
        {carry ? <p className={styles.rowNote}>{carry}</p> : null}
      </div>
      {renew ? <Button variant="secondary" href={renew}>Đăng ký lại</Button> : null}
    </li>
  );
}

function ClassCourse({ course }: { course: MyCourse }) {
  const time = courseTimeLine(course);
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <p className={styles.rowTitle}>{course.title}</p>
        <p className={styles.rowMeta}>
          <span>Mã do admin cấp</span>
          {time ? <span>{time}</span> : null}
        </p>
      </div>
    </li>
  );
}

function HistoryTable({ items }: { items: CreditRow[] }) {
  return (
    <table className={styles.table}>
      <caption className={styles.visuallyHidden}>Lịch sử lượt chấm AI, mới nhất trước</caption>
      <thead>
        <tr>
          <th scope="col">Ngày</th>
          <th scope="col">Nội dung</th>
          <th scope="col" className={styles.num}>Thay đổi</th>
          <th scope="col" className={styles.num}>Còn lại</th>
        </tr>
      </thead>
      <tbody>
        {items.map((row, i) => (
          <tr key={`${row.at ?? ''}-${i}`}>
            <td>{formatVnDate(row.at) ?? ''}</td>
            <td>{row.label}</td>
            <td className={styles.num}>{formatDelta(row.delta)}</td>
            <td className={styles.num}>{row.balanceAfter ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Everything private hangs under a key of the signed-in account: a session
 * change or sign-out unmounts it in the same render, so the previous
 * account's courses and credits never stay on screen, and its late replies
 * land in an unmounted tree (their requests are aborted too).
 */
export function AccountPage() {
  const { status, user } = useAuth();
  const accountId = status === 'signed-in' ? user?.id ?? null : null;
  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);
  if (!accountId) {
    return (
      <div className={styles.page}>
        <PageState kind="loading" title="Đang tải tài khoản…" />
      </div>
    );
  }
  return <AccountContent key={accountId} email={user?.email ?? null} />;
}

function AccountContent({ email }: { email: string | null }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [history, setHistory] = useState<History>({ kind: 'idle' });
  const [reload, setReload] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const [exportAbsent, setExportAbsent] = useState(false);
  const alive = useRef<AbortController | null>(null);
  const learner = useLearnerMe();
  const role = learner.status === 'ready' ? learner.me?.role ?? null : null;
  const onCancelled = useCallback(() => { setCancelled(true); setReload((n) => n + 1); }, []);
  const onExportAbsent = useCallback(() => setExportAbsent(true), []);

  const loadHistory = useCallback(async (signal: AbortSignal) => {
    setHistory({ kind: 'loading' });
    const res = await read('/api/me/credits', signal, new URLSearchParams({ limit: '20' }));
    if (signal.aborted) return;
    const page = res.ok ? normalizeCreditPage(res.data) : null;
    setHistory(page ? { kind: 'ready', items: page.items, nextCursor: page.nextCursor, more: 'idle' } : { kind: 'error' });
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    alive.current = abort;
    setPhase({ kind: 'loading' });
    setHistory({ kind: 'idle' });
    (async () => {
      const ok = await whenGlobalReady(() => typeof window.api?.getWith === 'function', 'window.api (account)');
      if (abort.signal.aborted) return;
      if (!ok) { setPhase({ kind: 'error' }); return; }
      // ACCOUNTDATA-0100 FR-003: read first; a pending account reaches no other route.
      const del = await read('/api/account/deletion-request', abort.signal);
      if (abort.signal.aborted) return;
      const deletion = del.ok ? normalizeDeletion(del.data) : null;
      if (deletion && deletion.status !== 'none') { setPhase({ kind: 'pending', deletion }); return; }
      const dataRights: DataRights = deletion ? 'none' : (!del.ok && del.status === 404 ? 'absent' : 'failed');
      const res = await read('/api/me/courses', abort.signal);
      if (abort.signal.aborted) return;
      const courses = res.ok ? normalizeMyCourses(res.data) : null;
      // 404 or a foreign shape: G04 is not there. Anything else is a failure.
      const coursesFailed = !courses && !(res.ok || res.status === 404);
      let classes: ClassRow[] = [];
      let classesIncomplete = false;
      if (!courses) {
        // A failed or degraded class read is not "no class": warn instead.
        const cls = await read('/api/class/me', abort.signal, new URLSearchParams({ summary: 'true' }));
        if (abort.signal.aborted) return;
        classes = cls.ok ? classesFromClassMe(cls.data) : [];
        classesIncomplete = !cls.ok || classMeIncomplete(cls.data);
      }
      setPhase({ kind: 'ready', courses, coursesFailed, classes, classesIncomplete, dataRights });
      if (courses) void loadHistory(abort.signal);
    })();
    return () => abort.abort();
  }, [loadHistory, reload]);

  const loadMore = useCallback(async () => {
    if (history.kind !== 'ready' || !history.nextCursor || history.more === 'loading') return;
    const signal = alive.current?.signal;
    setHistory({ ...history, more: 'loading' });
    const res = await read('/api/me/credits', signal, new URLSearchParams({ limit: '20', cursor: history.nextCursor }));
    if (signal?.aborted) return;
    const page = res.ok ? normalizeCreditPage(res.data) : null;
    setHistory(page
      ? { kind: 'ready', items: [...history.items, ...page.items], nextCursor: page.nextCursor, more: 'idle' }
      : { ...history, more: 'error' });
  }, [history]);

  const actions = [
    ACTIVATE ? { href: ACTIVATE, label: 'Nhập mã kích hoạt của lớp' } : null,
    COURSES ? { href: COURSES, label: 'Đăng ký thêm khoá' } : null,
    ORDERS ? { href: ORDERS, label: 'Đơn đăng ký của tôi' } : null,
  ].filter((a): a is { href: string; label: string } => a !== null);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Tài khoản</p>
        <h1 className={styles.title}>Khoá học và lượt chấm</h1>
        <p className={styles.lead}>Khoá bạn đang có, số lượt chấm AI còn lại và lịch sử dùng lượt.</p>
      </header>

      {phase.kind === 'loading' ? <PageState kind="loading" title="Đang tải tài khoản…" /> : null}
      {phase.kind === 'error' ? (
        <PageState
          kind="error"
          title="Chưa tải được trang Tài khoản"
          body="Kết nối có thể đang chập chờn."
          action={<Button variant="secondary" onClick={() => window.location.reload()}>Tải lại</Button>}
        />
      ) : null}

      {phase.kind === 'pending' ? (
        <>
          <PendingDeletionNotice view={phase.deletion} onCancelled={onCancelled} />
          {phase.deletion.status === 'pending' ? <DataExportBlock /> : null}
        </>
      ) : null}

      {phase.kind === 'ready' ? (
        <>
          {cancelled ? (
            <Notice kind="success" live="status" className={styles.notice}>
              Đã huỷ yêu cầu xoá. Bạn học tiếp bình thường.
            </Notice>
          ) : null}
          {phase.coursesFailed ? (
            <Notice kind="error" live="alert" className={styles.notice}>
              Chưa tải được thông tin khoá. Tải lại trang để thử lại.
            </Notice>
          ) : null}

          <section className={styles.section} aria-labelledby="khoa-online">
            <h2 id="khoa-online" className={styles.sectionTitle}>Khoá online</h2>
            {phase.courses === null ? (
              phase.coursesFailed ? null : <p className={styles.muted}>Thông tin khoá online sẽ có khi bạn đăng ký.</p>
            ) : phase.courses.online.length ? (
              <ul className={styles.rows}>
                {phase.courses.online.map((c, i) => <OnlineCourse key={`${c.code}-${i}`} course={c} />)}
              </ul>
            ) : (
              <p className={styles.muted}>Bạn chưa có khoá online nào.</p>
            )}
          </section>

          <section className={styles.section} aria-labelledby="khoa-lop">
            <h2 id="khoa-lop" className={styles.sectionTitle}>Khoá của lớp</h2>
            {phase.courses ? (
              phase.courses.classes.length ? (
                <ul className={styles.rows}>
                  {phase.courses.classes.map((c, i) => <ClassCourse key={`${c.code}-${i}`} course={c} />)}
                </ul>
              ) : (
                <p className={styles.muted}>Bạn chưa ở lớp nào.</p>
              )
            ) : phase.classes.length || phase.classesIncomplete ? (
              <>
              {phase.classesIncomplete ? (
                <Notice kind="warning" live="alert" className={styles.notice}>
                  Chưa tải đủ thông tin lớp của bạn. Tải lại trang để thử lại.
                </Notice>
              ) : null}
              <ul className={styles.rows}>
                {phase.classes.map((c) => (
                  <li key={c.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>{c.name}</p>
                      <p className={styles.rowMeta}>
                        <span>Mã do admin cấp</span>
                        {c.course ? <span>{c.course}</span> : null}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              </>
            ) : (
              <p className={styles.muted}>Bạn chưa ở lớp nào.</p>
            )}
          </section>

          {phase.courses && phase.courses.total !== null ? (
            <section className={styles.section} aria-labelledby="luot-cham">
              <h2 id="luot-cham" className={styles.sectionTitle}>Lượt chấm AI còn lại</h2>
              <p className={styles.total}>
                <span className={styles.totalNumber}>{phase.courses.total}</span> lượt
              </p>
              <p className={styles.muted}>Dùng chung cho Writing và Speaking.</p>
              {creditSourceLines(phase.courses).length ? (
                <dl className={styles.sources}>
                  {creditSourceLines(phase.courses).map((line) => (
                    <div key={line.key} className={styles.source}>
                      <dt>{line.label}</dt>
                      <dd>{line.value} lượt</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </section>
          ) : null}

          {contentVisibleLine(phase.courses) ? (
            <p className={styles.notice}>
              {contentVisibleLine(phase.courses)}
              {PROGRESS ? <> <a href={PROGRESS} className={styles.link}>Xem Tiến độ</a></> : null}
            </p>
          ) : null}

          {phase.courses ? (
            <section className={styles.section} aria-labelledby="lich-su-luot">
              <h2 id="lich-su-luot" className={styles.sectionTitle}>Lịch sử lượt</h2>
              {history.kind === 'loading' || history.kind === 'idle' ? (
                <p role="status" className={styles.muted}>Đang tải lịch sử lượt…</p>
              ) : null}
              {history.kind === 'error' ? (
                <Notice kind="error" live="alert">Chưa tải được lịch sử lượt. Tải lại trang để thử lại.</Notice>
              ) : null}
              {history.kind === 'ready' ? (
                history.items.length ? (
                  <>
                    <div className={styles.tableWrap}><HistoryTable items={history.items} /></div>
                    {history.more === 'error' ? (
                      <Notice kind="error" live="alert" className={styles.notice}>Chưa tải thêm được. Thử lại.</Notice>
                    ) : null}
                    {history.nextCursor ? (
                      <div className={styles.more}>
                        <Button variant="secondary" onClick={loadMore} loading={history.more === 'loading'} loadingLabel="Đang tải…">
                          Xem thêm
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className={styles.muted}>Chưa có lượt nào được cộng hay dùng.</p>
                )
              ) : null}
            </section>
          ) : null}

          {actions.length ? (
            <nav className={styles.actions} aria-label="Việc với khoá học">
              {actions.map((a) => <Button key={a.href} variant="secondary" href={a.href}>{a.label}</Button>)}
            </nav>
          ) : null}

          {phase.dataRights === 'failed' ? (
            <Notice kind="error" live="alert" className={styles.notice}>
              Chưa tải được phần dữ liệu và xoá tài khoản. Tải lại trang để thử lại.
            </Notice>
          ) : null}
          {phase.dataRights === 'none' && !exportAbsent ? <DataExportBlock onUnavailable={onExportAbsent} /> : null}
          {phase.dataRights === 'none' ? <DeleteAccountZone email={email} role={role} /> : null}
        </>
      ) : null}
    </div>
  );
}
