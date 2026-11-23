'use client';

// ENROLL-0060 FR-035/036, G05-T12 màn 1 — `/courses/[slug]/enroll` (tờ ThanhToan màn 1).
//
// The server passes the guest view of the course (the summary on the right).
// In the browser:
// - signed out → `/login?next=/courses/<slug>/enroll` (the same link as
//   "Đăng ký khoá này"), so the visitor comes back to this step;
// - signed in → one read of `/api/courses/<slug>` with the session. An open
//   order for this course goes straight to its page (ui-states: "đã có đơn mở
//   → chuyển tới đơn đó"); a learner still in the course, or a course that no
//   longer takes enrolments, sees why and a way back, not the form.
//
// The order is created only by "Tạo đơn và xem thông tin chuyển khoản", after
// the agreement box is ticked; leaving before that leaves no order. One
// `request_key` per opening of the step, so a double click or a retry after a
// lost answer is the same order (G04 replays it). The created or already open
// order (FR-036) is opened at `/enroll/<order_code>` (orderHref, G05-T12a).
// A failed create keeps the ticked box and says why.
//
// Contact fields: name and email come from the account and are not editable
// here. FR-035's optional phone number is left out: G04's create-order API
// has no field for it, and the page does not ask for data nobody stores.

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Notice, PageState, Stepper, type Step } from '@/components/ui';
import { getCurrentUser } from '@/lib/auth-api';
import { useAuth } from '@/lib/auth/auth-provider';
import { createEnrollmentOrder, fetchCourseForViewer } from '@/lib/commerce-client';
import {
  carryOverSentence, courseRowState, enrollErrorView, enrollHref, formatVnd, orderHref,
} from '@/lib/commerce-model.mjs';
import type { CourseDetail } from '@/lib/commerce-types';
import { coursesHref } from '@/lib/public-commerce.mjs';

import styles from './enroll.module.css';

const LEARN_HREF = '/home';
const TERMS_HREF = '/terms';
// PUBLICSITE-0059 câu 6: the refund policy is one section of /terms.
const REFUND_HREF = '/terms#hoan-tien';
const SUBMIT = 'Tạo đơn và xem thông tin chuyển khoản';

const STEPS: readonly Step[] = [
  { label: 'Kiểm tra đơn đăng ký', status: 'current' },
  { label: 'Chuyển khoản học phí', status: 'todo' },
  { label: 'Chờ xác nhận', status: 'todo' },
];

type ViewerRead = 'waiting' | 'loading' | 'ready' | 'error';
type Blocked = 'learning' | 'not_open' | null;

function newRequestKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function shortName(course: CourseDetail): string {
  return course.short_title || course.title;
}

function levelText(course: CourseDetail): string | null {
  if (course.level_from && course.level_to) return `${course.level_from} → ${course.level_to}`;
  return course.level_from ?? course.level_to ?? null;
}

/** Why this account cannot make an order for this course now (null: it can). */
function blockedReason(course: CourseDetail): Blocked {
  const state = courseRowState(course);
  if (state === 'learning' && !course.viewer?.can_renew) return 'learning';
  if (course.status !== 'open') return 'not_open';
  return null;
}

function Summary({ course, renewing }: { course: CourseDetail; renewing: boolean }) {
  const level = levelText(course);
  const fee = typeof course.tuition_vnd === 'number' && course.tuition_vnd > 0 ? formatVnd(course.tuition_vnd) : null;
  const rows: [string, string][] = [];
  if (level) rows.push(['Trình độ', level]);
  if (typeof course.access_days === 'number' && course.access_days > 0) rows.push(['Thời hạn truy cập', `${course.access_days} ngày`]);
  if (course.ai_credits > 0) rows.push(['Lượt chấm AI kèm theo', `${course.ai_credits} lượt`]);
  if (fee) rows.push(['Học phí cần chuyển', fee]);
  return (
    <aside className={styles.summary} aria-labelledby="enroll-summary">
      <p id="enroll-summary" className={styles.summaryLabel}>Bạn đang đăng ký</p>
      <p className={styles.summaryTitle}>{course.title}</p>
      {rows.length ? (
        <dl className={styles.facts}>
          {rows.map(([dt, dd]) => <div key={dt}><dt>{dt}</dt><dd>{dd}</dd></div>)}
        </dl>
      ) : null}
      {course.credits_expire_note ? <p className={styles.note}>{course.credits_expire_note}</p> : null}
      {renewing ? <p className={styles.note}>{carryOverSentence(course)}</p> : null}
      <p className={styles.note}><a href={coursesHref() ?? '/'}>Đổi sang khoá khác</a></p>
    </aside>
  );
}

export function EnrollPage({ course: initial }: { course: CourseDetail }) {
  const { status, user } = useAuth();
  const signedIn = status === 'signed-in';
  const accountId = signedIn ? user?.id ?? null : null;
  const [course, setCourse] = useState<CourseDetail>(initial);
  const [read, setRead] = useState<ViewerRead>('waiting');
  const [name, setName] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof enrollErrorView> | null>(null);
  const requestKey = useRef<string>('');
  const inFlight = useRef(false);
  const generation = useRef(0);

  // Signed out: sign in first, then come back here (FR-030 `next`).
  useEffect(() => {
    if (status === 'signed-out') window.location.replace(enrollHref(initial.slug, false));
  }, [status, initial.slug]);

  const loadViewer = useCallback((gen: number) => {
    setRead('loading');
    fetchCourseForViewer(initial.slug).then(
      (data) => {
        if (gen !== generation.current) return;
        if (!data || data.slug !== initial.slug || !data.viewer) { setRead('error'); return; }
        if (data.viewer.state === 'open_order' && data.viewer.open_order_code) {
          window.location.replace(orderHref(data.viewer.open_order_code));
          return;
        }
        setCourse(data);
        setRead('ready');
      },
      () => { if (gen === generation.current) setRead('error'); },
    );
  }, [initial.slug]);

  // One account at a time: a sign-in, sign-out or A → B starts the step over
  // (new request_key, box unticked, earlier answers dropped).
  useEffect(() => {
    const gen = ++generation.current;
    requestKey.current = newRequestKey();
    inFlight.current = false;
    setCourse(initial);
    setAgreed(false);
    setBusy(false);
    setFailure(null);
    setName(null);
    if (!accountId) { setRead('waiting'); return () => { generation.current += 1; }; }
    loadViewer(gen);
    const abort = new AbortController();
    getCurrentUser(abort.signal, { noRedirect: true }).then(
      (me) => { if (gen === generation.current) setName(me?.display_name?.trim() || null); },
      () => undefined,
    );
    return () => { generation.current += 1; abort.abort(); };
  }, [accountId, initial, loadViewer]);

  const submit = useCallback(() => {
    if (!agreed || inFlight.current || failure?.final) return;
    inFlight.current = true;
    const gen = generation.current;
    setBusy(true);
    setFailure(null);
    createEnrollmentOrder(initial.slug, requestKey.current).then(
      (answer) => {
        if (gen !== generation.current) return;
        const code = answer?.order?.order_code;
        if (typeof code === 'string' && code) {
          window.location.assign(orderHref(code));
          return;
        }
        inFlight.current = false;
        setBusy(false);
        setFailure(enrollErrorView(null));
      },
      (error) => {
        if (gen !== generation.current) return;
        const view = enrollErrorView(error);
        if (view.newKey) requestKey.current = newRequestKey();
        inFlight.current = false;
        setBusy(false);
        setFailure(view);
      },
    );
  }, [agreed, failure, initial.slug]);

  const catalog = coursesHref() ?? '/';
  const crumb = (
    <nav className={styles.crumb} aria-label="Đường dẫn">
      <a href={catalog}>Khoá học</a> <span aria-hidden="true">›</span>{' '}
      <a href={`/courses/${encodeURIComponent(initial.slug)}`}>{shortName(course)}</a>{' '}
      <span aria-hidden="true">›</span> <span aria-current="page">Đăng ký</span>
    </nav>
  );

  if (read === 'waiting' || read === 'loading') {
    return (
      <div className={styles.page}>
        {crumb}
        <PageState kind="loading" title="Đang mở đơn đăng ký" />
      </div>
    );
  }

  if (read === 'error') {
    return (
      <div className={styles.page}>
        {crumb}
        <PageState
          kind="error"
          title="Chưa tải được thông tin đăng ký của bạn"
          body="Chưa có đơn nào được tạo. Bạn thử lại nhé."
          action={<Button variant="secondary" onClick={() => loadViewer(generation.current)}>Thử lại</Button>}
        />
      </div>
    );
  }

  const blocked = blockedReason(course);
  const renewing = !!course.viewer?.can_renew;
  const courseHref = `/courses/${encodeURIComponent(initial.slug)}`;

  if (blocked) {
    return (
      <div className={styles.page}>
        {crumb}
        <PageState
          kind="empty"
          title={blocked === 'learning' ? 'Bạn đang học khoá này' : 'Khoá này chưa mở đăng ký'}
          body={blocked === 'learning'
            ? 'Bạn đăng ký lại được khi khoá gần hết hạn.'
            : 'Bạn có thể bật "Báo cho tôi khi mở" ở trang khoá.'}
          action={blocked === 'learning'
            ? <Button href={LEARN_HREF}>Vào học</Button>
            : <Button variant="secondary" href={courseHref}>Về trang khoá</Button>}
        />
      </div>
    );
  }

  const email = user?.email ?? '';
  const stopped = !!failure?.final;
  const access = typeof course.access_days === 'number' && course.access_days > 0
    ? ` Khoá có thời hạn ${course.access_days} ngày kể từ ngày mở.`
    : '';

  return (
    <div className={styles.page}>
      {crumb}
      <div className={styles.layout}>
        <div className={styles.main}>
          <h1 className={styles.title}>{renewing ? 'Đăng ký lại' : 'Đăng ký'} {course.title}</h1>
          <Stepper steps={STEPS} label="Các bước đăng ký khoá" className={styles.steps} />

          <section className={styles.section} aria-labelledby="enroll-who">
            <h2 id="enroll-who">Thông tin người đăng ký</h2>
            <p className={styles.muted}>Lấy sẵn từ tài khoản, dùng để đối chiếu và gửi email.</p>
            <dl className={styles.who}>
              {name ? <div><dt>Họ và tên</dt><dd>{name}</dd></div> : null}
              <div>
                <dt>Email</dt>
                <dd>{email}</dd>
                <dd className={styles.muted}>Email của tài khoản; khoá sẽ mở trên đúng tài khoản này.</dd>
              </div>
            </dl>
          </section>

          <section className={styles.section} aria-label="Đồng ý điều khoản">
            <label className={styles.agree}>
              <input
                type="checkbox"
                checked={agreed}
                disabled={busy || stopped}
                onChange={(event) => setAgreed(event.currentTarget.checked)}
              />
              <span>
                Tôi đã đọc và đồng ý với <a href={TERMS_HREF}>Điều khoản sử dụng</a> và{' '}
                <a href={REFUND_HREF}>Chính sách hoàn tiền</a>.{access}
              </span>
            </label>

            {failure ? (
              <Notice
                kind={failure.final ? 'warning' : 'error'}
                live="alert"
                action={failure.final ? <Button variant="secondary" href={courseHref}>Về trang khoá</Button> : undefined}
              >
                {failure.message}
              </Notice>
            ) : null}

            <div className={styles.submit}>
              <Button
                size="lg"
                onClick={submit}
                disabled={!agreed || stopped}
                loading={busy}
                loadingLabel="Đang tạo đơn…"
                aria-describedby="enroll-hint"
              >
                {SUBMIT}
              </Button>
              <p id="enroll-hint" className={styles.muted}>
                {agreed
                  ? 'Đơn chỉ được tạo khi bạn bấm nút. Hạn giữ đơn hiện ở bước chuyển khoản.'
                  : 'Đánh dấu ô đồng ý điều khoản để tạo đơn.'}
              </p>
            </div>
          </section>
        </div>
        <Summary course={course} renewing={renewing} />
      </div>
    </div>
  );
}
