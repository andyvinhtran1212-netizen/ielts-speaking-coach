'use client';

// PUBLICSITE-0059 T05 — the body of `/courses/[slug]` (tờ TrangKhoaHoc).
//
// Data truth: the server passes the guest view of the course; a signed-in
// visitor's own `viewer` block comes from one browser read with the session.
// That read is bound to the account (sign-in, sign-out, A → B start over; an
// answer for an earlier viewer is dropped). When it fails the page says so and
// keeps the guest view; it never guesses a personal state.
//
// Every block whose data is empty is left out (FR-004, FR-025): no "0", no
// "XXX", no empty box. Course names come from the data only (FR-028); the
// narrow places (breadcrumb, bottom bar) use `short_title` when there is one.
// All numbers about credits come from G04 (FR-024, carryOverSentence).

import { useCallback, useEffect, useRef, useState } from 'react';

import { OpenAlertToggle } from '@/components/courses/open-alert-toggle';
import { OpenAlertUnsubscribeNotice } from '@/components/courses/open-alert-unsubscribe-notice';
import { Button, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-provider';
import { fetchCourseForViewer, fetchMyCourses } from '@/lib/commerce-client';
import {
  carryOverSentence, courseRowLabel, courseRowState, enrollHref, formatViDate, formatVnd,
} from '@/lib/commerce-model.mjs';
import type { CourseChapter, CourseDetail } from '@/lib/commerce-types';
import { COURSE_ACCESS_ACTIONS, accessActionLabel } from '@/lib/course-access-labels.mjs';
import { coursesHref } from '@/lib/public-commerce.mjs';

import styles from './course.module.css';

/** Where "Vào học" goes until G07's course hub `/course` is live (same as /courses). */
const LEARN_HREF = '/home';
const CONTINUE_PAYMENT = 'Tiếp tục thanh toán';
const PAY_NOTE = 'Thanh toán bằng chuyển khoản, mở khoá sau khi xác nhận.';
const PANEL_ID = 'dang-ky';

type ViewerRead = 'none' | 'loading' | 'ready' | 'error';
type PanelState = ReturnType<typeof courseRowState> | 'open_order';

const LESSON_KINDS: Record<string, string> = {
  video: 'Video',
  reading: 'Bài đọc',
  exercise: 'Bài tập',
  writing: 'Bài viết',
  speaking: 'Bài nói',
};

function panelState(course: CourseDetail): PanelState {
  const state = courseRowState(course);
  if (state === 'open' && course.viewer?.state === 'open_order' && course.viewer.open_order_code) return 'open_order';
  return state;
}

function shortName(course: CourseDetail): string {
  return course.short_title || course.title;
}

function levelText(course: CourseDetail): string | null {
  if (course.level_from && course.level_to) return `${course.level_from} → ${course.level_to}`;
  return course.level_from ?? course.level_to ?? null;
}

function chapterList(course: CourseDetail): CourseChapter[] {
  return (course.chapters ?? []).filter((chapter) => chapter && chapter.title && Array.isArray(chapter.lessons));
}

function firstPreviewHref(course: CourseDetail): string | null {
  for (const chapter of chapterList(course)) {
    for (const lesson of chapter.lessons) if (lesson.is_preview && lesson.preview_href) return lesson.preview_href;
  }
  return null;
}

function hasWritingOrSpeaking(course: CourseDetail): boolean {
  return (course.features ?? []).some((f) => /^(writing|speaking)$/i.test(f));
}

// ── Facts (one source for the panel and the bottom bar) ───────────────────

type Fact = { label: string; value: string };

function facts(course: CourseDetail, state: PanelState): Fact[] {
  const out: Fact[] = [];
  const fee = state === 'open' || state === 'open_order' || state === 'expired' ? formatVnd(course.tuition_vnd) : null;
  if (fee && course.status === 'open') out.push({ label: 'Học phí', value: fee });
  if (typeof course.access_days === 'number' && course.access_days > 0) out.push({ label: 'Thời hạn truy cập', value: `${course.access_days} ngày` });
  if (course.ai_credits > 0) out.push({ label: 'Lượt chấm AI', value: `${course.ai_credits} lượt` });
  if (typeof course.lesson_count === 'number' && course.lesson_count > 0) out.push({ label: 'Bài học', value: `${course.lesson_count} bài` });
  return out;
}

function FactList({ items }: { items: Fact[] }) {
  if (!items.length) return null;
  return (
    <dl className={styles.facts}>
      {items.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** FR-024: exactly three points; a point whose data is missing loses only that clause. */
function WhatYouGet({ course }: { course: CourseDetail }) {
  const credits = course.ai_credits > 0
    ? `${course.ai_credits} lượt chấm AI, Writing và Speaking dùng chung một kho lượt${course.credits_expire_note ? ` (hạn dùng: ${course.credits_expire_note})` : ''}.`
    : 'Lượt chấm AI của khoá là một kho chung cho Writing và Speaking.';
  return (
    <section className={styles.get} aria-labelledby="ban-co-gi">
      <h3 id="ban-co-gi">Đăng ký khoá này bạn có gì</h3>
      <ul>
        <li>
          Khi admin xác nhận đơn, tài khoản được kích hoạt: mở luôn phần luyện Reading, Listening, ngữ pháp và từ vựng
          dành cho tài khoản đã kích hoạt.
        </li>
        <li>{credits}</li>
        <li>{carryOverSentence(course)}</li>
      </ul>
    </section>
  );
}

// ── Registration panel (one primary action per state) ─────────────────────

type Primary = { label: string; href: string } | null;

function primaryAction(course: CourseDetail, state: PanelState, signedIn: boolean): Primary {
  switch (state) {
    case 'open':
      return { label: accessActionLabel('can_enroll') ?? COURSE_ACCESS_ACTIONS.enroll, href: enrollHref(course.slug, signedIn) };
    case 'open_order':
      return { label: CONTINUE_PAYMENT, href: `/enroll/${encodeURIComponent(course.viewer.open_order_code ?? '')}` };
    case 'learning':
      return { label: accessActionLabel('enrolled') ?? COURSE_ACCESS_ACTIONS.continue, href: LEARN_HREF };
    case 'expired':
      // Only while the course takes enrolments (CR #2623): otherwise there is nothing to sign up for.
      if (course.status !== 'open') return null;
      return { label: accessActionLabel('expired') ?? COURSE_ACCESS_ACTIONS.renew, href: enrollHref(course.slug, signedIn) };
    default:
      return null;
  }
}

function RegistrationPanel({
  course, state, signedIn, visibleUntil,
}: { course: CourseDetail; state: PanelState; signedIn: boolean; visibleUntil: string | null }) {
  const primary = primaryAction(course, state, signedIn);
  const opensOn = state === 'upcoming' ? formatViDate(course.expected_open_on) : null;
  const preview = state === 'upcoming' ? null : firstPreviewHref(course);
  const label = state === 'open_order' ? courseRowLabel({ status: course.status, viewer: null }) : courseRowLabel(course);
  const badge = state === 'open_order' ? 'open' : state;

  return (
    <aside className={styles.panel} id={PANEL_ID} aria-label="Đăng ký khoá học">
      <span className={styles.badge} data-state={badge}>{label}</span>
      {state === 'upcoming' ? <p className={styles.muted}>Học phí công bố khi mở đăng ký</p> : null}
      {opensOn ? <p className={styles.muted}>Dự kiến mở: {opensOn}</p> : null}
      <FactList items={facts(course, state)} />

      {state === 'open' || state === 'open_order' ? <WhatYouGet course={course} /> : null}

      {primary ? (
        <div className={styles.primary}>
          <Button href={primary.href} variant="primary" size="lg">{primary.label}</Button>
        </div>
      ) : null}

      {state === 'upcoming' || (state === 'expired' && !primary) ? <OpenAlertToggle slug={course.slug} /> : null}

      {state === 'expired' ? (
        <>
          {primary ? <p className={styles.note}>{carryOverSentence(course)}</p> : <p className={styles.note}>Khoá này hiện chưa mở đăng ký lại.</p>}
          {visibleUntil ? (
            <p className={styles.note}>Bài đã nộp và nhận xét vẫn xem được trong Tiến độ đến {visibleUntil}.</p>
          ) : null}
        </>
      ) : null}

      {state === 'learning' && course.viewer?.can_renew ? (
        <div className={styles.renew}>
          <a href={enrollHref(course.slug, signedIn)}>{COURSE_ACCESS_ACTIONS.renew}</a>
          <p className={styles.note}>{carryOverSentence(course)}</p>
        </div>
      ) : null}

      {state === 'open' || state === 'open_order' || state === 'expired' ? (
        <>
          <p className={styles.note}>{PAY_NOTE}</p>
          <p className={styles.note}>
            <strong>Có mã kích hoạt?</strong> Mã do admin hoặc giáo viên cấp cho học viên lớp offline để vào khoá của lớp;
            không dùng để đăng ký khoá online này.
          </p>
        </>
      ) : null}

      {preview && (state === 'open' || state === 'open_order') ? (
        <p className={styles.note}><a href={preview}>Học thử trước khi đăng ký</a></p>
      ) : null}
    </aside>
  );
}

/** Below 1024px the panel's one action sits in a bar at the bottom (CSS decides which is shown). */
function BottomBar({ course, state, signedIn }: { course: CourseDetail; state: PanelState; signedIn: boolean }) {
  const primary = state === 'upcoming'
    ? { label: 'Báo cho tôi khi mở', href: `#${PANEL_ID}` }
    : primaryAction(course, state, signedIn);
  const fee = state === 'open' ? formatVnd(course.tuition_vnd) : null;
  const opensOn = state === 'upcoming' ? formatViDate(course.expected_open_on) : null;
  const label = state === 'open_order' ? courseRowLabel({ status: course.status, viewer: null }) : courseRowLabel(course);
  return (
    <div className={styles.bar} data-course-bar="">
      <div className={styles.barText}>
        <p className={styles.barTitle}>{shortName(course)}</p>
        <p className={styles.muted}>{fee ? `Học phí ${fee}` : opensOn ? `Dự kiến mở: ${opensOn}` : label}</p>
      </div>
      {primary ? <Button href={primary.href} variant="primary">{primary.label}</Button> : null}
    </div>
  );
}

// ── Content blocks ────────────────────────────────────────────────────────

function Author({ course }: { course: CourseDetail }) {
  const author = course.author;
  if (!author || !(author.name || author.bio_line)) return null;
  const video = firstPreviewHref(course);
  return (
    <section className={styles.section} aria-labelledby="nguoi-soan">
      <h2 id="nguoi-soan">Người soạn và giảng</h2>
      <div className={styles.author}>
        {author.photo_url ? <img className={styles.photo} src={author.photo_url} alt="" width={96} height={96} /> : null}
        <div>
          {author.name ? <p className={styles.authorName}>{author.name}</p> : null}
          {author.bio_line ? <p>{author.bio_line}</p> : null}
          {video && course.status === 'open' ? <a href={video}>Xem video bài học thử <span aria-hidden="true">›</span></a> : null}
        </div>
      </div>
    </section>
  );
}

function Chapters({ course, state }: { course: CourseDetail; state: PanelState }) {
  const chapters = chapterList(course);
  // FR-007: guests open chapters 1 and 2. A learner opens the chapter with the
  // next lesson; the API has no progress yet, so that is chapter 1.
  const [open, setOpen] = useState<Set<number>>(() => new Set(state === 'learning' ? [0] : [0, 1]));
  if (!chapters.length) return null;
  const upcoming = state === 'upcoming';
  const toggle = (index: number) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });
  return (
    <section className={styles.section} aria-labelledby="chuong-trinh">
      <h2 id="chuong-trinh">{upcoming ? 'Chương trình dự kiến' : 'Chương trình'}</h2>
      <ol className={styles.chapters}>
        {chapters.map((chapter, index) => {
          const expanded = open.has(index);
          const panelId = `chuong-${index + 1}`;
          return (
            <li key={`${index}-${chapter.title}`} className={styles.chapter}>
              <h3 className={styles.chapterHead}>
                <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => toggle(index)}>
                  <span>Chương {index + 1} · {chapter.title}</span>
                  <span className={styles.muted}>{chapter.lessons.length} bài</span>
                  <span aria-hidden="true">{expanded ? '−' : '+'}</span>
                </button>
              </h3>
              <ul id={panelId} className={styles.lessons} hidden={!expanded}>
                {chapter.lessons.map((lesson, i) => {
                  const kind = LESSON_KINDS[lesson.kind] ?? null;
                  const minutes = typeof lesson.duration_min === 'number' && lesson.duration_min > 0 ? `${lesson.duration_min} phút` : null;
                  const preview = !upcoming && lesson.is_preview && lesson.preview_href;
                  return (
                    <li key={`${i}-${lesson.title}`} className={styles.lesson}>
                      {preview ? <a href={lesson.preview_href as string}>{lesson.title}</a> : <span>{lesson.title}</span>}
                      <span className={styles.muted}>{[kind, minutes].filter(Boolean).join(' · ')}</span>
                      {preview ? <span className={styles.previewTag}>Học thử</span> : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Credits({ course }: { course: CourseDetail }) {
  if (!(course.ai_credits > 0)) return null;
  return (
    <section className={styles.section} aria-labelledby="luot-cham">
      <h2 id="luot-cham">Lượt chấm AI dùng vào đâu</h2>
      <p>
        Khoá kèm {course.ai_credits} lượt chấm AI, gắn với tài khoản của bạn
        {course.credits_expire_note ? ` (hạn dùng: ${course.credits_expire_note})` : ''}. Writing và Speaking dùng chung
        một kho lượt. Bài tập tự chấm không dùng lượt.
      </p>
      <p>{carryOverSentence(course)}</p>
    </section>
  );
}

/** FR-025: only on a course whose features include Writing or Speaking. An illustration, not a learner's work. */
function FeedbackSample({ course }: { course: CourseDetail }) {
  if (!hasWritingOrSpeaking(course)) return null;
  return (
    <section className={styles.section} aria-labelledby="nhan-xet">
      <h2 id="nhan-xet">Nhận xét trông thế nào</h2>
      <figure className={styles.sample}>
        <figcaption className={styles.muted}>Mảnh giao diện · phiếu nhận xét · ví dụ minh hoạ, không phải bài của học viên</figcaption>
        <p lang="en">Technology <mark>make</mark> some jobs disappear, but young people can sell <mark>things</mark> to customers in other countries.</p>
        <ol>
          <li>Ngữ pháp · “make” → <strong lang="en">makes</strong>. Chủ ngữ số ít cần động từ thêm s.</li>
          <li>Từ vựng · “things” → <strong lang="en">goods</strong>. Từ cụ thể hơn, hợp văn phong học thuật.</li>
        </ol>
      </figure>
    </section>
  );
}

/** FR-007: one answer open at a time. */
function Faq({ course }: { course: CourseDetail }) {
  const items = (course.faq ?? []).filter((item) => item && item.q && item.a);
  const [open, setOpen] = useState<number | null>(0);
  if (!items.length) return null;
  return (
    <section className={styles.section} aria-labelledby="hoi-dap">
      <h2 id="hoi-dap">Câu hỏi thường gặp về khoá</h2>
      <ul className={styles.faq}>
        {items.map((item, index) => {
          const expanded = open === index;
          const id = `hoi-dap-${index + 1}`;
          return (
            <li key={`${index}-${item.q}`}>
              <h3>
                <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setOpen(expanded ? null : index)}>
                  <span>{item.q}</span>
                  <span aria-hidden="true">{expanded ? '−' : '+'}</span>
                </button>
              </h3>
              <div id={id} hidden={!expanded}><p>{item.a}</p></div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export function CoursePage({ course: initial }: { course: CourseDetail }) {
  const { status, user } = useAuth();
  const signedIn = status === 'signed-in';
  const viewerKey = signedIn ? `user:${user?.id ?? ''}` : status;
  const [course, setCourse] = useState<CourseDetail>(initial);
  const [read, setRead] = useState<ViewerRead>('none');
  const [visibleUntil, setVisibleUntil] = useState<string | null>(null);
  const generation = useRef(0);

  const loadViewer = useCallback((gen: number) => {
    setRead('loading');
    fetchCourseForViewer(initial.slug).then(
      (data) => {
        if (gen !== generation.current) return;
        if (!data || data.slug !== initial.slug || !data.viewer) { setRead('error'); return; }
        setCourse(data);
        setRead('ready');
        if (courseRowState(data) !== 'expired') return;
        // FR-024: the "still readable until" line; a failed read just hides it.
        fetchMyCourses().then(
          (mine) => { if (gen === generation.current) setVisibleUntil(formatViDate(mine?.content_visible_until)); },
          () => undefined,
        );
      },
      () => { if (gen === generation.current) setRead('error'); },
    );
  }, [initial.slug]);

  useEffect(() => {
    const gen = ++generation.current;
    setCourse(initial);
    setVisibleUntil(null);
    if (signedIn) loadViewer(gen); else setRead('none');
    return () => { generation.current += 1; };
  }, [viewerKey, signedIn, initial, loadViewer]);

  const state = panelState(course);
  const level = levelText(course);
  const catalog = coursesHref() ?? '/';

  return (
    <div className={styles.page}>
      <OpenAlertUnsubscribeNotice slug={course.slug} />
      {read === 'error' ? (
        <Notice
          kind="warning"
          live="alert"
          action={<Button variant="secondary" onClick={() => loadViewer(generation.current)}>Thử lại</Button>}
        >
          Chưa tải được trạng thái khoá học của bạn. Trang dưới đây là thông tin chung.
        </Notice>
      ) : null}

      <nav className={styles.crumb} aria-label="Đường dẫn">
        <a href={catalog}>Khoá học</a> <span aria-hidden="true">›</span> <span aria-current="page">{shortName(course)}</span>
      </nav>

      <div className={styles.layout} aria-busy={read === 'loading' || undefined}>
        <div className={styles.main}>
          <header className={styles.intro}>
            <p className={styles.eyebrow}>Khoá online{level ? ` · trình độ ${level}` : ''}</p>
            <h1>{course.title}</h1>
            {course.summary ? <p className={styles.summary}>{course.summary}</p> : null}
          </header>
          <Author course={course} />
          <Chapters key={`${viewerKey}-${state}`} course={course} state={state} />
          <Credits course={course} />
          <FeedbackSample course={course} />
          {/* Slot "Học viên khoá này nói gì" (spec 0059 mục 10 câu 18): drawn only when real reviews exist. */}
          <Faq course={course} />
        </div>
        <RegistrationPanel course={course} state={state} signedIn={signedIn} visibleUntil={visibleUntil} />
      </div>
      <BottomBar course={course} state={state} signedIn={signedIn} />
    </div>
  );
}
