'use client';

// Lộ trình `/course` (LEARNERCORE-0063 amendment 1, FR-030…FR-037), sheet
// thiet-ke/LoTrinh.dc.html. One read of `GET /api/student/course`, then the
// lessons of the selected course from COURSELESSON-0064. Writes nothing; every
// link goes through `liveHref`, so a target that is not live yet is not a link.
//
// Data is owned by the account that loaded it (same rule as Today, HOLD
// 10:28Z on #2543): a load is aborted by the next load, an account change or
// unmount, and a stale answer is never drawn.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageState } from '@/components/ui/page-state';
import { liveHref } from '@/components/ui/shell/learner-sections';
import { getBrowserJson } from '@/lib/browser-api';
import { replaceAcrossTrees } from '@/lib/tree-replace';
import {
  assignedCardLabel,
  classMeta,
  lessonsFailure,
  normalizeCourse,
  normalizeLessons,
  onlineMeta,
  selectedCourse,
  shouldRedirectToAssigned,
  type CourseHub as Course,
  type CourseLessons,
} from '@/lib/course-hub-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import styles from './course-hub.module.css';

/** FR-030: "Bài được giao" is /course/assigned once Đợt 8 runs, /my-class before. */
export const ASSIGNED_HREF = liveHref({ href: '/course/assigned', today: '/my-class' }) ?? '/my-class';
const CLASS_HREF = liveHref({ href: '/course/class', today: null });
const COURSES_HREF = liveHref({ href: '/courses', today: null });
const ACTIVATE_HREF = liveHref({ href: '/activate', today: null });

const ONLINE_NOTE = 'AI chấm và trả nhận xét ngay';
const CLASS_NOTE = 'Speaking: AI chấm và trả ngay. Writing: AI chấm, giáo viên duyệt rồi mới trả';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; course: Course; owner: string };

type LessonsPhase =
  | { kind: 'idle' }
  | { kind: 'loading'; code: string }
  | { kind: 'ready'; code: string; lessons: CourseLessons }
  | { kind: 'soon'; code: string }
  | { kind: 'expired'; code: string }
  | { kind: 'error'; code: string };

function courseHref(code: string): string {
  return `/course?course=${encodeURIComponent(code)}`;
}

function BlockError({ title }: { title: string }) {
  return (
    <Notice kind="warning" title={title} live="none">
      Phần này chưa tải được. Các phần khác vẫn dùng được; tải lại trang để thử lại.
    </Notice>
  );
}

function Group({ title, note, collapsed, onToggle, children }: {
  title: string; note: string; collapsed: boolean | null; onToggle: () => void; children: React.ReactNode;
}) {
  // collapsed === null: the group is always open (the learner has this kind).
  const bodyId = `group-${title.replace(/\s+/g, '-')}`;
  return (
    <section className={styles.group} aria-label={title}>
      {collapsed === null ? (
        <h2 className={styles.groupTitle}>{title}</h2>
      ) : (
        <h2 className={styles.groupTitle}>
          <button type="button" className={styles.toggle} aria-expanded={!collapsed}
            aria-controls={bodyId} onClick={onToggle}>
            {title}
          </button>
        </h2>
      )}
      {collapsed ? null : <div id={bodyId} className={styles.groupBody}>{children}</div>}
      <p className={styles.note}>{note}</p>
    </section>
  );
}

function OnlineGroup({ course, current, collapsed, onToggle, onSelect }: {
  course: Course; current: string | null; collapsed: boolean | null;
  onToggle: () => void; onSelect: (code: string) => void;
}) {
  let body: React.ReactNode;
  if (course.degraded.has('online')) {
    body = <BlockError title="Khoá online của bạn" />;
  } else if (!course.online.length) {
    body = (
      <>
        <p className={styles.empty}>
          Bạn chưa đăng ký khoá online nào. Sáu khoá kỹ năng dự kiến: Grammar, Listening, Reading,
          Writing, Speaking, Vocabulary Skills + Ideas.
        </p>
        {COURSES_HREF ? <Button href={COURSES_HREF} variant="secondary" size="sm">Xem các khoá</Button> : null}
      </>
    );
  } else {
    body = (
      <ul className={styles.list}>
        {course.online.map((row) => (
          <li key={row.code} className={styles.row} aria-current={row.code === current ? 'true' : undefined}>
            <div className={styles.rowText}>
              <span className={styles.itemTitle}>{row.title}</span>
              <span className={styles.meta}>{onlineMeta(row)}</span>
              {row.expired ? <span className={styles.meta}>Đăng ký lại để học tiếp từ bài đang dở.</span> : null}
            </div>
            {row.expired ? null : row.code === current ? (
              <span className={styles.meta}>Đang xem</span>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => onSelect(row.code)}>Xem bài học</Button>
            )}
          </li>
        ))}
      </ul>
    );
  }
  const others = course.degraded.has('other_products') ? null : course.others
    .map((item) => ({ ...item, href: liveHref({ href: `/courses/${encodeURIComponent(item.slug)}`, today: null }) }))
    .filter((item) => item.href);
  return (
    <Group title="Khoá online của bạn" note={ONLINE_NOTE} collapsed={collapsed} onToggle={onToggle}>
      {body}
      {others && others.length ? (
        <div className={styles.others}>
          <h3 className={styles.subTitle}>Khoá online khác · dự kiến</h3>
          <ul className={styles.list}>
            {others.map((item) => (
              <li key={item.slug} className={styles.row}>
                <span className={styles.itemTitle}>{item.title}</span>
                <Button href={item.href as string} variant="secondary" size="sm">Xem khoá</Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Group>
  );
}

function ClassGroup({ course, current, collapsed, onToggle, onSelect }: {
  course: Course; current: string | null; collapsed: boolean | null;
  onToggle: () => void; onSelect: (code: string) => void;
}) {
  let body: React.ReactNode;
  if (course.degraded.has('class')) {
    body = <BlockError title="Khoá của lớp" />;
  } else if (!course.klass) {
    body = (
      <>
        <p className={styles.empty}>
          Bạn chưa vào lớp nào. Học viên lớp offline nhập mã giáo viên hoặc admin cấp để vào khoá của lớp.
        </p>
        {ACTIVATE_HREF ? <Button href={ACTIVATE_HREF} variant="secondary" size="sm">Nhập mã kích hoạt</Button> : null}
      </>
    );
  } else {
    const meta = classMeta(course.klass);
    body = (
      <>
        {meta ? <p className={styles.itemTitle}>{meta}</p> : null}
        {course.klass.repractice.length ? (
          <ul className={styles.list}>
            {course.klass.repractice.map((row) => (
              <li key={row.code} className={styles.row} aria-current={row.code === current ? 'true' : undefined}>
                <span className={styles.itemTitle}>{row.title}</span>
                {row.code === current ? <span className={styles.meta}>Đang xem</span> : (
                  <Button variant="secondary" size="sm" onClick={() => onSelect(row.code)}>Xem bài học</Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </>
    );
  }
  return (
    <Group title="Khoá của lớp" note={CLASS_NOTE} collapsed={collapsed} onToggle={onToggle}>{body}</Group>
  );
}

function Lessons({ phase, title, onRetry }: { phase: LessonsPhase; title: string | null; onRetry: () => void }) {
  if (phase.kind === 'idle') return null;
  let body: React.ReactNode;
  if (phase.kind === 'loading') {
    body = <PageState kind="loading" title="Đang tải bài học" />;
  } else if (phase.kind === 'soon') {
    body = <p className={styles.empty}>Bài học của khoá sẽ mở dần.</p>;
  } else if (phase.kind === 'expired') {
    body = <p className={styles.empty}>Khoá đã hết hạn. Đăng ký lại để học tiếp từ bài đang dở.</p>;
  } else if (phase.kind === 'error') {
    body = (
      <Notice kind="error" title="Chưa tải được bài học" live="status"
        action={<Button variant="secondary" size="sm" onClick={onRetry}>Thử lại</Button>} />
    );
  } else if (phase.lessons.comingSoon) {
    body = <p className={styles.empty}>Bài học của khoá sẽ mở dần.</p>;
  } else {
    body = (
      <>
        {phase.lessons.stages.map((stage, index) => (
          <div key={stage.no ?? index} className={styles.stage}>
            <h3 className={styles.subTitle}>
              {[stage.no ? `Chặng ${stage.no}` : null, stage.title].filter(Boolean).join(' · ') || 'Bài học'}
            </h3>
            <ul className={styles.list}>
              {stage.lessons.map((lesson) => {
                const href = liveHref({
                  href: `/course/learn/${encodeURIComponent(phase.code)}/${encodeURIComponent(lesson.code)}`,
                  today: null,
                });
                const label = [lesson.no ? `Bài ${lesson.no}` : null, lesson.title].filter(Boolean).join('. ');
                return (
                  <li key={lesson.code} className={styles.row}>
                    <div className={styles.rowText}>
                      {href ? <a className={styles.link} href={href}>{label}</a> : <span className={styles.itemTitle}>{label}</span>}
                      {lesson.gate ? <span className={styles.meta}>{lesson.gate}</span> : null}
                    </div>
                    <span className={styles.state}>{lesson.state}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <p className={styles.note}>Thứ tự và nhãn Tiếp theo chỉ là gợi ý; bài nào cũng mở được.</p>
      </>
    );
  }
  return (
    <section className={styles.lessons} aria-label="Bài học của khoá">
      <h2 className={styles.groupTitle}>{title ?? 'Bài học của khoá'}</h2>
      {body}
    </section>
  );
}

export function CourseHubPage({ accountId }: { accountId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params?.get('course') ?? null;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [lessons, setLessons] = useState<LessonsPhase>({ kind: 'idle' });
  const [openOnline, setOpenOnline] = useState(false);
  const [openClass, setOpenClass] = useState(false);
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  const loadRef = useRef<AbortController | null>(null);
  const lessonsRef = useRef<AbortController | null>(null);
  useEffect(() => () => { loadRef.current?.abort(); lessonsRef.current?.abort(); }, []);

  const load = useCallback(async () => {
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    const owner = accountId;
    const stale = () => controller.signal.aborted || accountRef.current !== owner;
    setPhase({ kind: 'loading' });
    const ok = await whenGlobalReady(() => typeof window.api?.getWith === 'function', 'window.api (course)');
    if (stale()) return;
    if (!ok) { setPhase({ kind: 'error' }); return; }
    try {
      const raw: unknown = await getBrowserJson('/api/student/course', undefined, controller.signal);
      if (stale()) return;
      const course = normalizeCourse(raw);
      if (!course) { setPhase({ kind: 'error' }); return; }
      if (shouldRedirectToAssigned(course)) {
        // FR-035: replace, before any group is drawn. `/course/assigned` is in the
        // legacy tree (v1), so this is a full document replacement (FR-015).
        replaceAcrossTrees(router, ASSIGNED_HREF);
        return;
      }
      setPhase({ kind: 'ready', course, owner });
    } catch {
      if (stale()) return;
      setPhase({ kind: 'error' });
    }
  }, [accountId, router]);

  useEffect(() => { void load(); }, [load]);

  const owned = phase.kind === 'ready' && phase.owner === accountId ? phase.course : null;
  const current = owned ? selectedCourse(owned, requested) : null;

  const loadLessons = useCallback(async (code: string) => {
    lessonsRef.current?.abort();
    const controller = new AbortController();
    lessonsRef.current = controller;
    const owner = accountId;
    const stale = () => controller.signal.aborted || accountRef.current !== owner;
    setLessons({ kind: 'loading', code });
    try {
      // COURSELESSON-0064 owns this route; it enters the generated contract
      // when 0064 merges, so the call stays on the shared transport until then.
      const raw: unknown = await window.api.getWith<unknown>(
        `/api/course/${encodeURIComponent(code)}/lessons`, undefined, { signal: controller.signal });
      if (stale()) return;
      const parsed = normalizeLessons(raw);
      setLessons(parsed ? { kind: 'ready', code, lessons: parsed } : { kind: 'error', code });
    } catch (caught) {
      if (stale()) return;
      setLessons({ kind: lessonsFailure(caught), code });
    }
  }, [accountId]);

  const expiredSelected = owned?.online.find((row) => row.code === current)?.expired ?? false;
  useEffect(() => {
    // A new selection drops any lessons request of the previous one, so a late
    // answer cannot overwrite the empty or expired state (FR-037).
    lessonsRef.current?.abort();
    if (!current) { setLessons({ kind: 'idle' }); return; }
    // FR-037: the lesson list of an expired course is not shown.
    if (expiredSelected) { setLessons({ kind: 'expired', code: current }); return; }
    void loadLessons(current);
  }, [current, expiredSelected, loadLessons]);

  const select = useCallback((code: string) => router.replace(courseHref(code)), [router]);

  let body: React.ReactNode;
  if (phase.kind === 'error') {
    body = (
      <Notice kind="error" title="Chưa tải được Lộ trình" live="alert"
        action={<Button variant="secondary" size="sm" onClick={() => void load()}>Thử lại</Button>} />
    );
  } else if (!owned) {
    body = <PageState kind="loading" title="Đang tải Lộ trình" />;
  } else {
    const hasOnline = owned.online.length > 0 || owned.degraded.has('online');
    const hasClass = owned.hasClass || owned.degraded.has('class');
    // FR-033: with only one kind, the other group folds to one line.
    const onlineCollapsed = !hasOnline && hasClass ? !openOnline : null;
    const classCollapsed = hasOnline && !hasClass ? !openClass : null;
    const title = owned.online.find((row) => row.code === current)?.title
      ?? owned.klass?.repractice.find((row) => row.code === current)?.title ?? null;
    body = (
      <>
        <nav className={styles.cards} aria-label="Lộ trình">
          <a className={styles.card} href="/course" aria-current="page">Các khoá và bài học</a>
          <a className={styles.card} href={ASSIGNED_HREF}>
            {owned.degraded.has('assigned_open') ? 'Bài được giao' : assignedCardLabel(owned.assignedOpen)}
          </a>
          {owned.hasClass && CLASS_HREF ? <a className={styles.card} href={CLASS_HREF}>Buổi học và tài liệu lớp</a> : null}
        </nav>
        <div className={styles.columns}>
          <div className={styles.groups}>
            <OnlineGroup course={owned} current={current} collapsed={onlineCollapsed}
              onToggle={() => setOpenOnline((open) => !open)} onSelect={select} />
            <ClassGroup course={owned} current={current} collapsed={classCollapsed}
              onToggle={() => setOpenClass((open) => !open)} onSelect={select} />
          </div>
          <Lessons phase={lessons} title={title} onRetry={() => current && void loadLessons(current)} />
        </div>
      </>
    );
  }

  return (
    <main className={styles.main} aria-busy={!owned && phase.kind !== 'error' ? true : undefined}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Lộ trình</h1>
        <p className={styles.lead}>
          Khoá online bạn đã đăng ký và khoá của lớp do giáo viên cấp mã, xếp thành hai nhóm. Bài giáo viên
          giao cho lớp nằm ở thẻ bên cạnh.
        </p>
      </header>
      {body}
    </main>
  );
}
