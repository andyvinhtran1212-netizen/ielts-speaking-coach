'use client';

// "Buổi học và tài liệu lớp" (LEARNERCORE-0063 amendment 6, G07-T30c,
// FR-119…FR-125), sheet thiet-ke/LopBuoiHoc.dc.html screens 1, 2 and 4.
// Drawn at /course/class only when `learnerV2Enabled(me)` (`class-gate.tsx`).
//
// - Reads `GET /api/class/me` and `GET /api/student/assigned` once each on
//   entry (FR-124); changing class or session never reads again. "Thử lại"
//   re-reads only the block that failed.
// - Sessions and attachments are normalized by `/my-class`'s own rules
//   (`normalizeMyClassResponse`); session homework is matched by `lesson_id`
//   only (FR-123), never by `content_config.lesson_no`.
// - `degraded: ["class"]` means the archived-class filter could not run, so no
//   per-class block is drawn at all (HOLD patch).
// - No teacher comments, uploads/players or course test report (FR-125).
// - Data is owned by the account that loaded it (same rule as Today).
import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageState } from '@/components/ui/page-state';
import { Select } from '@/components/ui/select';
import { getBrowserJson } from '@/lib/browser-api';
import { openClassAssignment } from '@/lib/class-assignment-open';
import { assignedCardLabel } from '@/lib/course-hub-model.mjs';
import {
  STATUS_LABELS,
  classMeta,
  defaultLessonId,
  homeworkFor,
  learnedCount,
  lessonDateLabel,
  lessonHeading,
  lessonLinks,
  lessonStatus,
  lessonsOfClass,
  materialRows,
  pickClassId,
  selectionSearch,
  vnDay,
} from '@/lib/class-sessions-model.mjs';
import { normalizeMyClassResponse } from '@/lib/my-class-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import {
  ACTION_LABELS,
  normalizeAssigned,
  openCount,
  skillLabel,
  statusCopy,
  vnDateTime,
  type AssignedItem,
} from '../assigned/assigned-v2-model';
import { openSelfPractice, selfPracticeError } from '../assigned/assigned-v2-open';
import styles from './class-sessions-v2.module.css';

type MyClass = NonNullable<ReturnType<typeof normalizeMyClassResponse>>;
type Lesson = { id: string; cohortId: string | null; title: string; lessonNo: number | null;
  lessonDate: string | null; bodyMarkdown: string; attachments: { label: string; url: string | null }[] };
type ClassInfo = { id: string | null; name: string | null; description: string | null;
  course: { code: string; name: string } | null };
type Material =
  | { key: string; kind: 'broken'; label: string }
  | { key: string; kind: 'youtube' | 'document'; label: string; url: string; type: string; action: string };
type Meta = Map<string, { teacher: string | null; schedule: string | null }>;

type ClassRead =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; owner: string; data: MyClass; meta: Meta; raw: Record<string, unknown> };

type WorkRead =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; owner: string; items: AssignedItem[]; links: Map<string, string>; linksDown: boolean };

function Markdown({ value }: { value: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    setHtml(null);
    void whenGlobalReady(() => typeof window.renderMarkdown === 'function', 'window.renderMarkdown (class)')
      .then((ready) => {
        if (!disposed && ready && window.renderMarkdown) setHtml(window.renderMarkdown(value, { breaks: true }));
      });
    return () => { disposed = true; };
  }, [value]);
  if (html == null) return <p className={styles.body}>{value}</p>;
  return <div className={styles.body} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Materials({ lesson }: { lesson: Lesson }) {
  const rows = materialRows(lesson.attachments) as Material[];
  return (
    <section className={styles.block} aria-label="Tài liệu buổi học">
      <h3 className={styles.blockTitle}>Tài liệu buổi học</h3>
      {rows.length ? (
        <ul className={styles.list}>
          {rows.map((row) => row.kind === 'broken' ? (
            <li key={row.key} className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.kind}>Tài liệu</span>
                <span className={styles.title}>{row.label}</span>
                <span className={styles.warn}>Chưa mở được tài liệu này. Các tài liệu khác vẫn dùng được.</span>
              </div>
            </li>
          ) : (
            <li key={row.key} className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.kind}>{row.type}</span>
                <span className={styles.title}>{row.label}</span>
              </div>
              <a className={styles.linkButton} href={row.url} target="_blank" rel="noopener noreferrer">{row.action}</a>
            </li>
          ))}
        </ul>
      ) : <p className={styles.meta}>Buổi này chưa có tài liệu.</p>}
    </section>
  );
}

function Homework({ work, lessonId, classId, opening, onOpen, onRetry }: {
  work: WorkRead; lessonId: string; classId: string; opening: string | null;
  onOpen: (entry: AssignedItem) => void; onRetry: () => void;
}) {
  const allLink = <a className={styles.more} href="/course/assigned">Bài tập của lớp ở Bài được giao ›</a>;
  if (work.kind === 'loading') return <p className={styles.meta}>Đang tải bài tập của buổi…</p>;
  if (work.kind === 'error') {
    return (
      <Notice kind="error" title="Chưa tải được bài tập của buổi." live="status"
        action={<Button variant="secondary" size="sm" onClick={onRetry}>Thử lại</Button>}>
        Bài bạn đã nộp không mất.
      </Notice>
    );
  }
  // `lesson_links` down: hide the block as when no work is tied to a session.
  if (work.linksDown) return allLink;
  const ofClass = work.items.filter((entry) => entry.row.assignment.cohortId === classId);
  const { show, rows } = homeworkFor(ofClass, work.links, lessonId) as { show: boolean; rows: AssignedItem[] };
  if (!show) return allLink;
  return (
    <section className={styles.block} aria-label="Bài tập về nhà của buổi">
      <div className={styles.blockHead}>
        <h3 className={styles.blockTitle}>Bài tập về nhà của buổi</h3>
        <a className={styles.more} href="/course/assigned">Xem trong Bài được giao ›</a>
      </div>
      {rows.length ? (
        <ul className={styles.list}>
          {rows.map((entry) => {
            const due = vnDateTime(entry.row.assignment.dueAt);
            const label = entry.action === 'none' ? null : ACTION_LABELS[entry.action];
            return (
              <li key={entry.row.itemId} className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.kind}>{skillLabel(entry.row.assignment.skill)}</span>
                  <span className={styles.title}>{entry.row.assignment.title}</span>
                  <span className={styles.meta}>
                    <span className={entry.group === 'overdue' ? styles.overdue : undefined}>{statusCopy(entry)}</span>
                    {due ? <span> · Hạn {due}</span> : null}
                  </span>
                </div>
                {label ? (
                  <Button variant="secondary" size="sm" loading={opening === entry.row.itemId}
                    loadingLabel="Đang mở…" onClick={() => onOpen(entry)}>{label}</Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : <p className={styles.meta}>Buổi này chưa có bài tập về nhà.</p>}
    </section>
  );
}

export function ClassSessionsV2({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [classRead, setClassRead] = useState<ClassRead>({ kind: 'loading' });
  const [work, setWork] = useState<WorkRead>({ kind: 'loading' });
  const [selection, setSelection] = useState<{ classId: string | null; lessonId: string | null }>(
    { classId: null, lessonId: null });
  const [opening, setOpening] = useState<string | null>(null);
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  // False once unmounted: a late start response must not navigate away from
  // whatever page (or account, the gate keys by it) replaced this one.
  const mountedRef = useRef(true);
  const openingRef = useRef<string | null>(null);
  const classAbort = useRef<AbortController | null>(null);
  const workAbort = useRef<AbortController | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const today = useMemo(() => vnDay(new Date()), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; classAbort.current?.abort(); workAbort.current?.abort(); };
  }, []);
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      openingRef.current = null;
      setOpening(null);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const loadClass = useCallback(async () => {
    classAbort.current?.abort();
    const controller = new AbortController();
    classAbort.current = controller;
    const owner = accountId;
    const stale = () => controller.signal.aborted || accountRef.current !== owner;
    setClassRead({ kind: 'loading' });
    const ok = await whenGlobalReady(() => typeof window.api?.getWith === 'function', 'window.api (class)');
    if (stale()) return;
    if (!ok) { setClassRead({ kind: 'error' }); return; }
    try {
      const raw = await getBrowserJson('/api/class/me', undefined, controller.signal) as Record<string, unknown>;
      if (stale()) return;
      const data = normalizeMyClassResponse(raw);
      if (!data) { setClassRead({ kind: 'error' }); return; }
      const degraded = Array.isArray(raw.degraded) ? raw.degraded as string[] : [];
      const meta = classMeta(raw.classes, degraded) as Meta;
      if (data.hasClass) {
        const params = new URLSearchParams(window.location.search);
        const classId = pickClassId(data.classes, params.get('class'));
        const lessons = (data.lessons || []) as Lesson[];
        const ofClass = lessonsOfClass(lessons, classId, data.classes?.length || 0);
        setSelection({ classId, lessonId: defaultLessonId(ofClass, params.get('session'), today) });
      }
      setClassRead({ kind: 'ready', owner, data, meta, raw });
    } catch {
      if (!stale()) setClassRead({ kind: 'error' });
    }
  }, [accountId, today]);

  const loadWork = useCallback(async () => {
    workAbort.current?.abort();
    const controller = new AbortController();
    workAbort.current = controller;
    const owner = accountId;
    const stale = () => controller.signal.aborted || accountRef.current !== owner;
    setWork({ kind: 'loading' });
    const ok = await whenGlobalReady(() => typeof window.api?.getWith === 'function', 'window.api (class work)');
    if (stale()) return;
    if (!ok) { setWork({ kind: 'error' }); return; }
    try {
      const raw = await getBrowserJson('/api/student/assigned', undefined, controller.signal) as Record<string, unknown>;
      if (stale()) return;
      const assigned = normalizeAssigned(raw);
      if (!assigned || assigned.degraded.has('items')) { setWork({ kind: 'error' }); return; }
      const linksDown = Array.isArray(raw.degraded) && raw.degraded.includes('lesson_links');
      setWork({ kind: 'ready', owner, items: assigned.items, links: lessonLinks(raw.items), linksDown });
    } catch {
      if (!stale()) setWork({ kind: 'error' });
    }
  }, [accountId]);

  useEffect(() => { void loadClass(); void loadWork(); }, [loadClass, loadWork]);

  const select = useCallback((next: { classId: string | null; lessonId: string | null }, scroll = false) => {
    setSelection(next);
    const search = selectionSearch(window.location.search, next);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
    if (scroll) detailRef.current?.scrollIntoView?.({ block: 'start' });
  }, []);

  const open = useCallback(async (entry: AssignedItem) => {
    if (openingRef.current) return;
    const owner = accountId;
    const isCurrent = () => mountedRef.current && accountRef.current === owner;
    openingRef.current = entry.row.itemId;
    setOpening(entry.row.itemId);
    try {
      if (entry.action === 'self_practice') await openSelfPractice(entry.row.itemId, { router, isCurrent });
      else await openClassAssignment(entry.row, { router, isCurrent });
    } catch (caught) {
      if (!isCurrent()) return;
      const message = entry.action === 'self_practice' ? selfPracticeError(caught)
        : caught instanceof Error ? caught.message : String(caught);
      window.showToast?.(`Không mở được bài: ${message}`, 'error', { timeout: 6000 });
      openingRef.current = null;
      setOpening(null);
    }
  }, [accountId, router]);

  const owned = classRead.kind === 'ready' && classRead.owner === accountId ? classRead : null;
  const ownedWork: WorkRead = work.kind === 'ready' && work.owner !== accountId ? { kind: 'loading' } : work;

  let body: React.ReactNode;
  if (classRead.kind === 'error') {
    body = (
      <Notice kind="error" title="Chưa tải được trang lớp." live="alert"
        action={<Button variant="secondary" size="sm" onClick={() => void loadClass()}>Thử lại</Button>}>
        Bài bạn đã nộp và tài liệu của lớp không mất.
      </Notice>
    );
  } else if (!owned) {
    body = <PageState kind="loading" title="Đang tải buổi học…" />;
  } else if (!owned.data.hasClass) {
    body = (
      <Notice kind="info" live="none" action={<Button href="/course" variant="secondary" size="sm">Về Lộ trình</Button>}>
        Bạn chưa ở lớp nào. Bài và tài liệu của lớp hiện ở đây khi giáo viên thêm bạn vào lớp.
      </Notice>
    );
  } else if ((owned.data.warnings || []).includes('class')) {
    // HOLD patch: the archived-class filter did not run; draw nothing per class.
    body = (
      <Notice kind="warning" title="Chưa xác minh được lớp của bạn." live="status"
        action={<Button variant="secondary" size="sm" onClick={() => void loadClass()}>Thử lại</Button>}>
        Tải lại để xem buổi học và tài liệu của lớp.
      </Notice>
    );
  } else {
    const { data, meta } = owned;
    const classes = (data.classes || []) as ClassInfo[];
    const classId = selection.classId || classes[0]?.id || null;
    const cls = classes.find((c) => c.id === classId) || classes[0];
    const lessons = data.lessons ? lessonsOfClass(data.lessons as Lesson[], classId, classes.length) as Lesson[] : null;
    const lesson = lessons?.find((l) => l.id === selection.lessonId) || null;
    const info = cls?.id ? meta.get(cls.id) : undefined;
    const sub = [cls?.course?.name, info?.teacher ? `giáo viên ${info.teacher}` : null, info?.schedule]
      .filter(Boolean).join(' · ');
    body = (
      <>
        <section className={styles.summary} aria-label="Lớp của bạn">
          <div className={styles.summaryText}>
            <h2 className={styles.className}>{cls?.name || 'Lớp của bạn'}</h2>
            {sub ? <p className={styles.meta}>{sub}</p> : null}
            {cls?.description ? <p className={styles.meta}>{cls.description}</p> : null}
          </div>
          {lessons ? <p className={styles.learned}>Đã học {learnedCount(lessons, today)} buổi</p> : null}
          {classes.length > 1 ? (
            <Select label="Lớp" className={styles.picker} value={classId || ''}
              options={classes.map((c) => ({ value: c.id as string, label: c.name || 'Lớp' }))}
              onChange={(next) => {
                const nextLessons = data.lessons ? lessonsOfClass(data.lessons as Lesson[], next, classes.length) : [];
                select({ classId: next, lessonId: defaultLessonId(nextLessons, null, today) });
              }} />
          ) : null}
        </section>
        {!lessons ? (
          <Notice kind="error" title="Chưa tải được buổi học" live="status"
            action={<Button variant="secondary" size="sm" onClick={() => void loadClass()}>Thử lại</Button>}>
            Bài tập của lớp vẫn ở Bài được giao.
          </Notice>
        ) : !lessons.length ? (
          <p className={styles.empty}>Giáo viên chưa đăng buổi học nào.</p>
        ) : (
          <div className={styles.split}>
            <section ref={listRef} className={styles.sessions} aria-label="Các buổi học">
              <h2 className={styles.blockTitle}>Các buổi học</h2>
              <ol className={styles.sessionList}>
                {lessons.map((l) => {
                  const status = lessonStatus(l, today);
                  const date = lessonDateLabel(l.lessonDate);
                  return (
                    <li key={l.id}>
                      <button type="button" className={styles.session}
                        aria-current={l.id === lesson?.id ? 'true' : undefined}
                        onClick={() => select({ classId, lessonId: l.id }, true)}>
                        <span className={styles.sessionNo}>{lessonHeading(l)}</span>
                        <span className={styles.title}>{l.title}</span>
                        <span className={styles.meta}>
                          {[l.lessonNo != null ? date : null, status ? STATUS_LABELS[status] : null].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
            {lesson ? (
              <article ref={detailRef} className={styles.detail} aria-label={`${lessonHeading(lesson)} · ${lesson.title}`}>
                <button type="button" className={styles.back}
                  onClick={() => listRef.current?.scrollIntoView?.({ block: 'start' })}>‹ Danh sách buổi</button>
                <p className={styles.meta}>
                  {[lessonHeading(lesson), lesson.lessonNo != null ? lessonDateLabel(lesson.lessonDate) : null]
                    .filter(Boolean).join(' · ')}
                  {lessonStatus(lesson, today) ? ` · ${STATUS_LABELS[lessonStatus(lesson, today) as keyof typeof STATUS_LABELS]}` : ''}
                </p>
                <h2 className={styles.detailTitle}>{lesson.title}</h2>
                {lesson.bodyMarkdown ? <Markdown value={lesson.bodyMarkdown} /> : null}
                <Materials lesson={lesson} />
                {classId ? (
                  <Homework work={ownedWork} lessonId={lesson.id} classId={classId} opening={opening}
                    onOpen={(entry) => void open(entry)} onRetry={() => void loadWork()} />
                ) : null}
              </article>
            ) : null}
          </div>
        )}
      </>
    );
  }

  const hasClass = Boolean(owned?.data.hasClass);
  const count = ownedWork.kind === 'ready' ? openCount(ownedWork.items) : 0;
  return (
    <div className={`av2-root ${styles.page}`}>
      <main className={styles.main} aria-busy={!owned && classRead.kind !== 'error' ? true : undefined}>
        <header className={styles.header}>
          <h1 className={styles.heading}>Lộ trình</h1>
          <p className={styles.lead}>
            Khoá online bạn đã đăng ký và khoá của lớp do giáo viên cấp mã, xếp thành hai nhóm. Bài giáo viên
            giao cho lớp nằm ở thẻ bên cạnh.
          </p>
        </header>
        <nav className={styles.cards} aria-label="Lộ trình">
          <a className={styles.card} href="/course">Các khoá và bài học</a>
          <a className={styles.card} href="/course/assigned">{assignedCardLabel(count)}</a>
          {hasClass ? <a className={styles.card} href="/course/class" aria-current="page">Buổi học và tài liệu lớp</a> : null}
        </nav>
        {body}
      </main>
    </div>
  );
}

export default ClassSessionsV2;
