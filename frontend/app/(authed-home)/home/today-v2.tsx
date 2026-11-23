'use client';

// The new Today page (LEARNERCORE-0063 T14), drawn at /home only when
// `learnerV2Enabled(me)` (FR-075; the switch is `home-tree-switch.tsx`, which
// loads this module lazily so the old tree gets no new CSS or request).
//
// - One `GET /api/student/today` on entry; the layout follows `state` and
//   `banner` as the server returns them, never re-derived here (FR-019).
// - Each block gets its own slice and its own `degraded` flag (FR-026): a broken
//   part fails only its block; a source that does not exist yet is simply empty
//   and its block is hidden.
// - Links go only to live routes (`liveHref`), so no block points at a 404.
// - The only write is `POST /api/student/today/seen`, after the "Vừa có kết quả"
//   block has rendered (FR-078); a failure is logged and the same results come
//   back next time.
// - Assigned rows open their exact item through `openClassAssignment`, the same
//   code `/my-class` uses (FR-022), so there is no second URL builder.
//
// `home.css` stays loaded under this tree (the layout is a server component and
// cannot read the flag): the G03 components set their own colours and link
// decoration, so its global `a` and `box-sizing` rules do not leak in.
import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageState } from '@/components/ui/page-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { liveHref } from '@/components/ui/shell/learner-sections';
import { openClassAssignment } from '@/lib/class-assignment-open';
import { assignmentAction, normalizeClassAssignment } from '@/lib/my-class-model.mjs';
import {
  assignedRows,
  creditRows,
  goalCopy,
  hasClassCredits,
  headingCopy,
  lessonActionCopy,
  minutesCopy,
  normalizeToday,
  orderStatusCopy,
  resumeKindCopy,
  todayCount,
  vnDateCopy,
} from '@/lib/today-v2-model.mjs';
import { getBrowserJson, postBrowserJsonAt } from '@/lib/browser-api';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import styles from './today-v2.module.css';

type Today = NonNullable<ReturnType<typeof normalizeToday>>;
type ClassRow = NonNullable<ReturnType<typeof normalizeClassAssignment>>;
type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; sessionNotCurrent: boolean }
  | { kind: 'ready'; today: Today; owner: string };

const LIBRARY = liveHref({ href: '/library', today: null });
const COURSES = liveHref({ href: '/courses', today: null });
const ACTIVATE = liveHref({ href: '/activate', today: null });
const PROGRESS = liveHref({ href: '/progress', today: null });
const ASSIGNED = liveHref({ href: '/course/assigned', today: '/my-class' });

function enrollHref(code: string): string | null {
  return liveHref({ href: `/enroll/${encodeURIComponent(code)}`, today: null });
}

function BlockError({ title }: { title: string }) {
  return (
    <Notice kind="warning" title={title} live="none">
      Phần này chưa tải được. Các phần khác vẫn dùng được; tải lại trang để thử lại.
    </Notice>
  );
}

function Section({ title, children, label }: { title: string; children: React.ReactNode; label?: string }) {
  return (
    <section className={styles.block} aria-label={label ?? title}>
      <h2 className={styles.blockTitle}>{title}</h2>
      {children}
    </section>
  );
}

// ── blocks ────────────────────────────────────────────────────────────────────

function NextLesson({ lesson }: { lesson: NonNullable<Today['nextLesson']> }) {
  const parts = [
    lesson.courseName,
    lesson.stageNo ? `Chặng ${lesson.stageNo}` : null,
    lesson.lessonNo && lesson.lessonCount ? `Bài ${lesson.lessonNo} trên ${lesson.lessonCount}` : null,
  ].filter(Boolean);
  const facts = [
    minutesCopy(lesson.videoSeconds) ? `Video ${minutesCopy(lesson.videoSeconds)}` : null,
    lesson.practiceItems ? `${lesson.practiceItems} câu luyện` : null,
  ].filter(Boolean);
  return (
    <Section title="Bài tiếp theo trong lộ trình">
      {parts.length ? <p className={styles.meta}>{parts.join(' · ')}</p> : null}
      <p className={styles.itemTitle}>{lesson.title}</p>
      {facts.length ? <p className={styles.meta}>{facts.join(' · ')}</p> : null}
      <Button href={lesson.href} variant="primary">{lessonActionCopy(lesson)}</Button>
    </Section>
  );
}

function Assigned({ today, opening, onOpen }: {
  today: Today; opening: string | null; onOpen: (row: ClassRow) => void;
}) {
  if (today.degraded.has('assigned')) {
    return <Section title="Bài được giao, hạn hôm nay và ngày mai"><BlockError title="Bài được giao" /></Section>;
  }
  const rows = assignedRows(today.assigned.map(normalizeClassAssignment));
  if (!rows.length && !today.dueLater && !today.mockExams.length) return null;
  return (
    <Section title="Bài được giao, hạn hôm nay và ngày mai">
      {rows.length ? (
        <ul className={styles.list}>
          {rows.map(({ row, overdue }) => {
            const action = assignmentAction(row);
            const due = vnDateCopy(row.assignment.dueAt);
            return (
              <li key={row.itemId} className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.itemTitle}>{row.assignment.title}</span>
                  <span className={styles.meta}>
                    {overdue ? <StatusBadge set="work" value="overdue" /> : null}
                    {due ? <span>Hạn {due}</span> : null}
                  </span>
                </div>
                {action && action.kind !== 'closed' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={opening === row.itemId}
                    loadingLabel="Đang mở…"
                    onClick={() => onOpen(row as ClassRow)}
                  >
                    {action.label}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {today.mockExams.length ? (
        <ul className={styles.list}>
          {today.mockExams.map((exam) => (
            <li key={exam.href} className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.itemTitle}>{exam.title}</span>
                {vnDateCopy(exam.closesAt) ? <span className={styles.meta}>Đóng {vnDateCopy(exam.closesAt)}</span> : null}
              </div>
              <Button href={exam.href} variant="secondary" size="sm">Mở kỳ thi</Button>
            </li>
          ))}
        </ul>
      ) : null}
      {today.dueLater > 0 ? (
        <p className={styles.meta}>
          Còn {today.dueLater} bài hạn sau ngày mai, không tính vào việc hôm nay.
          {ASSIGNED ? <> <a className={styles.link} href={ASSIGNED}>Xem bài được giao</a></> : null}
        </p>
      ) : null}
    </Section>
  );
}

function Resume({ today }: { today: Today }) {
  if (today.degraded.has('resume')) {
    return <Section title="Làm tiếp khi rảnh"><BlockError title="Làm tiếp khi rảnh" /></Section>;
  }
  if (!today.resume.length) return null;
  return (
    <Section title="Làm tiếp khi rảnh">
      <ul className={styles.list}>
        {today.resume.map((item) => (
          <li key={item.href} className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.itemTitle}>{item.title}</span>
              <span className={styles.meta}>
                {resumeKindCopy(item.kind)}
                {item.progress ? ` · ${item.progress.done} trên ${item.progress.total} phần` : ''}
              </span>
            </div>
            <Button href={item.href} variant="secondary" size="sm">Làm tiếp</Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Credits({ today }: { today: Today }) {
  // Not there, failed, or a legacy class code with no credits: hidden, never 0 (FR-024).
  if (!today.credits || today.degraded.has('credits')) return null;
  const rows = creditRows(today.credits);
  return (
    <Section title="Lượt chấm AI">
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={row.kind} className={styles.creditRow}>
            <span className={styles.creditNumber}>{row.remaining}</span>
            <span className={styles.meta}>{row.label}</span>
          </li>
        ))}
      </ul>
      {hasClassCredits(today.credits) ? (
        <p className={styles.meta}>Hết lượt thì liên hệ giáo viên để được cấp thêm.</p>
      ) : null}
      <p className={styles.meta}>Luyện Listening, Reading, từ vựng và ngữ pháp không tính lượt.</p>
    </Section>
  );
}

function NewResults({ today, onRendered }: { today: Today; onRendered: () => void }) {
  const shown = !today.degraded.has('new_results') && today.newResults.length > 0;
  useEffect(() => {
    if (shown) onRendered();
  }, [shown, onRendered]);
  if (today.degraded.has('new_results')) {
    return <Section title="Vừa có kết quả"><BlockError title="Vừa có kết quả" /></Section>;
  }
  if (!shown) return null;
  return (
    <Section title="Vừa có kết quả">
      <ul className={styles.list}>
        {today.newResults.map((result) => (
          <li key={result.key} className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.itemTitle}>{result.title}</span>
              {vnDateCopy(result.returnedAt) ? <span className={styles.meta}>Trả {vnDateCopy(result.returnedAt)}</span> : null}
            </div>
            <Button href={result.href} variant="secondary" size="sm">Mở phiếu</Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function RepeatError({ today }: { today: Today }) {
  const error = today.repeatError;
  if (!error) return null;
  return (
    <Section title="Lỗi đang lặp lại">
      <p className={styles.itemTitle}>{error.label}</p>
      <p className={styles.meta}>Gặp ở {error.count} trên {error.of} bài gần đây.</p>
      <div className={styles.actions}>
        {error.reviewHref ? <Button href={error.reviewHref} variant="secondary" size="sm">Ôn 10 phút</Button> : null}
        {PROGRESS ? <a className={styles.link} href={PROGRESS}>Xem cả {error.totalErrors} lỗi</a> : null}
      </div>
    </Section>
  );
}

function Banner({ today }: { today: Today }) {
  if (today.banner === 'out_of_credits') {
    // G07-T27's CreditsEmptyNotice is not on staging yet: the G03 Notice with its words.
    return (
      <Notice kind="warning" title="Bạn đã dùng hết lượt chấm AI." live="none">
        Bài Writing và Speaking mới chưa được chấm cho tới khi có thêm lượt.
        Luyện Listening, Reading, từ vựng và ngữ pháp vẫn không tính lượt.
      </Notice>
    );
  }
  if (today.banner === 'expiring') {
    return (
      <Notice kind="warning" title="Khoá học của bạn sắp hết hạn." live="none">
        Đăng ký lại trước ngày hết hạn để giữ tiến độ và lượt chấm.
      </Notice>
    );
  }
  if (today.banner === 'expired') {
    return (
      <Notice kind="warning" title="Khoá học của bạn đã hết hạn." live="none">
        Đăng ký lại để học tiếp bài trong lộ trình.
      </Notice>
    );
  }
  return null;
}

function NoCourse({ today }: { today: Today }) {
  return (
    <Section title="Bạn chưa có khoá học">
      {today.trialTodayLeft !== null ? (
        <p className={styles.meta}>Chấm thử hôm nay còn {today.trialTodayLeft} bài.</p>
      ) : null}
      <p className={styles.meta}>
        Bắt đầu một khoá để có lộ trình và lượt chấm AI, hoặc nhập mã kích hoạt nếu giáo viên đã gửi cho bạn.
      </p>
      <div className={styles.actions}>
        {COURSES ? <Button href={COURSES} variant="primary">Xem các khoá</Button> : null}
        {ACTIVATE ? <Button href={ACTIVATE} variant="secondary">Nhập mã kích hoạt của lớp</Button> : null}
        {LIBRARY ? <a className={styles.link} href={LIBRARY}>Đọc thư viện miễn phí</a> : null}
      </div>
    </Section>
  );
}

function OrderPending({ today }: { today: Today }) {
  if (today.degraded.has('orders_open')) {
    // The server says an order is pending; a failed order list is that
    // block's own error, never "no course" (FR-026).
    return <Section title="Đơn đăng ký của bạn"><BlockError title="Đơn đăng ký" /></Section>;
  }
  if (!today.orders.length) return <NoCourse today={today} />;
  return (
    <Section title="Đơn đăng ký của bạn">
      <ul className={styles.list}>
        {today.orders.map((order) => {
          const href = enrollHref(order.code);
          const supplement = vnDateCopy(order.supplementBy);
          return (
            <li key={order.code} className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.itemTitle}>{order.productTitle || 'Khoá học'}</span>
                <span className={styles.meta}>Mã đơn {order.code} · {orderStatusCopy(order.status)}</span>
                {order.status === 'needs_info' ? (
                  <Notice kind="warning" title="Đơn cần bổ sung" live="none">
                    {supplement ? `Bổ sung trước ${supplement} để đơn được xác nhận.` : 'Bổ sung thông tin để đơn được xác nhận.'}
                  </Notice>
                ) : null}
              </div>
              {href ? <Button href={href} variant="secondary" size="sm">Mở trang đơn</Button> : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export function TodayV2({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [opening, setOpening] = useState<string | null>(null);
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  const openingRef = useRef<string | null>(null);
  const seenSent = useRef<string | null>(null);

  // Every async step is owned by the account and the load that started it
  // (HOLD 10:28Z): a later load, an account switch or an unmount aborts it, and
  // its result is dropped instead of drawn under another account.
  const loadRef = useRef<AbortController | null>(null);
  useEffect(() => () => loadRef.current?.abort(), []);

  const load = useCallback(async () => {
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    const owner = accountId;
    const stale = () => controller.signal.aborted || accountRef.current !== owner;
    setPhase({ kind: 'loading' });
    const ok = await whenGlobalReady(() => typeof window.api?.getWith === 'function', 'window.api (today)');
    if (stale()) return;
    if (!ok) { setPhase({ kind: 'error', sessionNotCurrent: false }); return; }
    try {
      const raw: unknown = await getBrowserJson('/api/student/today', undefined, controller.signal);
      if (stale()) return;
      const today = normalizeToday(raw);
      setPhase(today ? { kind: 'ready', today, owner } : { kind: 'error', sessionNotCurrent: false });
      if (today) {
        // The read proved the session is signed in: settle any owed mock-exam
        // Speaking report, as the legacy Home does (home-behavior loadHome).
        // Fire and forget; a stuck sitting must never slow the page.
        const debt = (window as unknown as { SpeakingDebt?: { retryAll?: () => unknown } }).SpeakingDebt;
        if (debt && typeof debt.retryAll === 'function') debt.retryAll();
      }
    } catch (caught) {
      if (stale()) return;
      const err = caught as { status?: number; code?: string | null };
      setPhase({ kind: 'error', sessionNotCurrent: err?.status === 409 && err?.code === 'session_not_current' });
    }
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  // Data drawn and acted on only by the account that loaded it.
  const owned = phase.kind === 'ready' && phase.owner === accountId ? phase : null;
  const today = owned?.today ?? null;
  const markSeen = useCallback(() => {
    if (!owned) return;
    const cursor = owned.today.seenCursor;
    if (!cursor || accountRef.current !== owned.owner) return;
    const key = `${owned.owner}|${cursor.seen_until}|${cursor.seen_key}`;
    if (seenSent.current === key) return;
    seenSent.current = key;
    postBrowserJsonAt('/api/student/today/seen', '/api/student/today/seen', cursor).catch((caught: unknown) => {
      // FR-078: never shown to the learner; the same results come back next time.
      console.warn('[today] seen cursor not saved', caught instanceof Error ? caught.message : caught);
    });
  }, [owned]);

  const open = useCallback(async (row: ClassRow) => {
    if (openingRef.current) return;
    const owner = accountId;
    openingRef.current = row.itemId;
    setOpening(row.itemId);
    try {
      await openClassAssignment(row, { router, isCurrent: () => accountRef.current === owner });
    } catch (caught) {
      if (accountRef.current !== owner) return;
      const message = caught instanceof Error ? caught.message : String(caught);
      window.showToast?.(`Không mở được bài: ${message}`, 'error', { timeout: 6000 });
      openingRef.current = null;
      setOpening(null);
    }
  }, [accountId, router]);

  let body: React.ReactNode;
  if (phase.kind === 'loading' || (phase.kind === 'ready' && !owned)) {
    body = <PageState kind="loading" title="Đang tải việc hôm nay" />;
  } else if (phase.kind === 'error') {
    body = phase.sessionNotCurrent ? (
      <Notice kind="warning" title="Tài khoản đang mở ở một thiết bị khác." live="alert">
        Đăng nhập lại ở thiết bị này để tiếp tục.
      </Notice>
    ) : (
      <Notice
        kind="error"
        title="Chưa tải được việc hôm nay"
        live="alert"
        action={<Button variant="secondary" size="sm" onClick={() => void load()}>Thử lại</Button>}
      />
    );
  } else {
    const t = today as Today;
    const learning = t.state === 'learning' || t.state === 'first_day';
    const goal = goalCopy(t.goal);
    body = (
      <>
        <header className={styles.header}>
          <h1 className={styles.heading}>{learning ? headingCopy(t.name, todayCount(t)) : `Chào ${t.name || 'bạn'}.`}</h1>
          {goal ? (
            PROGRESS ? <a className={styles.link} href={PROGRESS}>{goal}</a> : <p className={styles.meta}>{goal}</p>
          ) : null}
        </header>
        {learning ? (
          <>
            <Banner today={t} />
            {t.nextLesson ? <NextLesson lesson={t.nextLesson} /> : null}
            <Assigned today={t} opening={opening} onOpen={(row) => void open(row)} />
            <NewResults today={t} onRendered={markSeen} />
            <RepeatError today={t} />
            <Resume today={t} />
            <Credits today={t} />
          </>
        ) : (
          <>
            {/* A failed class read falls back to an empty class on the server, so
                the state can read no_course for a class learner: the block's own
                warning shows first, never a bare "no course" (FR-026). */}
            {t.degraded.has('assigned') ? (
              <Assigned today={t} opening={opening} onOpen={(row) => void open(row)} />
            ) : null}
            {t.state === 'order_pending' ? <OrderPending today={t} /> : <NoCourse today={t} />}
          </>
        )}
      </>
    );
  }

  return (
    <div className={`av2-root ${styles.page}`}>
      <main className={styles.main} aria-busy={!owned && phase.kind !== 'error' ? true : undefined}>{body}</main>
    </div>
  );
}

export default TodayV2;
