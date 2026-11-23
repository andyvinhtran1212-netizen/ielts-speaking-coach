'use client';

// "Lần đầu vào": three short steps, each a plain page (no tour, no overlay,
// no floating bubble), skippable at every step (FR-065).
//
// - Shown once: `onboarding_completed=true` or a valid `?next=` sends the
//   visitor on before anything is drawn (`startRedirect`).
// - Step 2 (goal) is optional; it saves `target_band` / `exam_date` through
//   `PATCH /auth/profile`, the same place /progress and Today read.
// - Step 3 is pre-chosen from data: an active online course → "đã đăng ký khoá
//   online"; a class → step 3 is hidden and the flow ends at the assigned
//   work; nothing → "chưa có khoá nào". `GET /api/me/courses` is G04's: until
//   it exists the read fails and counts as "no online course" (nothing guessed).
// - Every way out ("Bỏ qua", "Để sau", the step-3 links) first writes
//   `onboarding_completed=true`, then leaves; a failed write keeps the learner
//   here with an error and a retry, never a silent loop.
// - No consent question and no request with "consent" in its URL (FR-066).
// - Links go only to live routes (`liveHref`).
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { Notice } from '@/components/ui/notice';
import { PageState } from '@/components/ui/page-state';
import { Select } from '@/components/ui/select';
import { liveHref } from '@/components/ui/shell/learner-sections';
import { getCurrentUser, type AuthMeWire } from '@/lib/auth-api';
import { useAuth } from '@/lib/auth/auth-provider';
import { patchBrowserJsonAt } from '@/lib/browser-api';
import {
  START_BANDS,
  goalPayload,
  hasActiveOnlineCourse,
  hasClass,
  startRedirect,
  startingPoint,
} from '@/lib/start-flow-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import styles from './start.module.css';

type Start = 'code' | 'online' | 'none';
type Phase =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; me: AuthMeWire; point: 'class' | 'online' | 'none' };

const HOME = '/home';
const LIBRARY = liveHref({ href: '/library', today: null });
const COURSES = liveHref({ href: '/courses', today: null });
const ACTIVATE = liveHref({ href: '/activate', today: null });
const COURSE = liveHref({ href: '/course', today: null });
const ASSIGNED = liveHref({ href: '/course/assigned', today: '/my-class' }) ?? HOME;

const BAND_OPTIONS = [{ value: '', label: 'Chưa biết' }, ...START_BANDS.map((b) => ({ value: b, label: b }))];

async function readOptional(path: string): Promise<unknown> {
  try {
    return await window.api.getWith<unknown>(path, undefined, undefined);
  } catch {
    return null;
  }
}

export function StartFlow() {
  const { status, user } = useAuth();
  const accountId = status === 'signed-in' ? user?.id ?? null : null;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [step, setStep] = useState(1);
  const [band, setBand] = useState('');
  const [examDate, setExamDate] = useState('');
  const [start, setStart] = useState<Start>('none');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [goalError, setGoalError] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dateId = useId();
  const firstStep = useRef(true);

  useEffect(() => {
    if (!accountId) return undefined;
    const abort = new AbortController();
    (async () => {
      const ok = await whenGlobalReady(() => typeof window.api?.getWith === 'function', 'window.api (start)');
      if (abort.signal.aborted) return;
      if (!ok) { setPhase({ kind: 'error' }); return; }
      let me: AuthMeWire;
      try {
        me = await getCurrentUser(abort.signal);
      } catch {
        if (!abort.signal.aborted) setPhase({ kind: 'error' });
        return;
      }
      if (abort.signal.aborted) return;
      const target = startRedirect(me, new URLSearchParams(window.location.search).get('next'));
      if (target) { window.location.replace(target); return; }
      const [courses, cls] = await Promise.all([readOptional('/api/me/courses'), readOptional('/api/class/me?summary=true')]);
      if (abort.signal.aborted) return;
      const point = startingPoint({ online: hasActiveOnlineCourse(courses), inClass: hasClass(cls) });
      setStart(point === 'online' ? 'online' : 'none');
      setPhase({ kind: 'ready', me, point });
    })();
    return () => abort.abort();
  }, [accountId]);

  // Each step is a new page for a screen reader: focus its heading.
  useEffect(() => {
    if (phase.kind !== 'ready') return;
    if (firstStep.current) { firstStep.current = false; return; }
    headingRef.current?.focus();
  }, [step, phase.kind]);

  const finish = useCallback(async (target: string) => {
    if (busy) return;
    setBusy(true);
    setSaveError(false);
    try {
      await patchBrowserJsonAt('/auth/profile', '/auth/profile', { onboarding_completed: true });
      window.location.assign(target);
    } catch {
      setSaveError(true);
      setBusy(false);
    }
  }, [busy]);

  const saveGoal = useCallback(async (inClass: boolean) => {
    const body = goalPayload({ band, examDate });
    if (Object.keys(body).length) {
      setBusy(true);
      setGoalError(false);
      try {
        await patchBrowserJsonAt('/auth/profile', '/auth/profile', body);
      } catch {
        setGoalError(true);
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    if (inClass) void finish(ASSIGNED);
    else setStep(3);
  }, [band, examDate, finish]);

  if (phase.kind === 'loading') {
    return (
      <main id="main-content" className={styles.page}>
        <PageState kind="loading" title="Đang mở trang bắt đầu…" />
      </main>
    );
  }
  if (phase.kind === 'error') {
    return (
      <main id="main-content" className={styles.page}>
        <PageState
          kind="error"
          title="Chưa mở được trang bắt đầu."
          body="Bạn vẫn vào trang chính được; trang này sẽ hiện lại lần sau."
          action={<Button href={HOME} variant="primary">Vào trang chính</Button>}
        />
      </main>
    );
  }

  const inClass = phase.point === 'class';
  const total = inClass ? 2 : 3;
  const name = phase.me.display_name?.trim() || 'bạn';
  const choices = [
    ...(ACTIVATE ? [{ value: 'code', label: 'Tôi có mã kích hoạt của lớp' }] : []),
    { value: 'online', label: 'Tôi đã đăng ký khoá online' },
    { value: 'none', label: 'Tôi chưa có khoá nào' },
  ];

  return (
    <div className={styles.frame}>
      <header className={styles.top}>
        <span className={styles.brand}>Aver Learning</span>
        <Button variant="text" onClick={() => void finish(HOME)} disabled={busy}>Bỏ qua, vào trang chính</Button>
      </header>
      <main id="main-content" className={styles.page}>
        <p className={styles.count}>Bước {step} trên {total}</p>
        {saveError ? (
          <Notice kind="error" live="alert" className={styles.notice}>Chưa lưu được. Thử lại.</Notice>
        ) : null}

        {step === 1 ? (
          <section aria-labelledby="start-step-title">
            <h1 id="start-step-title" ref={headingRef} tabIndex={-1} className={styles.title}>Chào {name}.</h1>
            <p className={styles.lead}>
              Mỗi khoá dạy một kỹ năng; trang Hôm nay gom việc của các khoá bạn có. Hai câu hỏi ngắn để trang Hôm nay đúng với bạn.
            </p>
            <dl className={styles.facts}>
              <div><dt>Lộ trình</dt><dd>Bài giảng xếp theo chặng, mỗi bài có video, bài đọc và bài luyện.</dd></div>
              <div><dt>Chấm bài</dt><dd>AI chấm Writing và Speaking. Writing của lớp offline có giáo viên duyệt rồi mới trả; Speaking trả ngay.</dd></div>
              <div><dt>Thư viện</dt><dd>Mở cho mọi người: bài mẫu Writing, đề Speaking, ngữ pháp, từ vựng.</dd></div>
            </dl>
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => setStep(2)}>Bắt đầu</Button>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section aria-labelledby="start-step-title">
            <h1 id="start-step-title" ref={headingRef} tabIndex={-1} className={styles.title}>Mục tiêu của bạn</h1>
            <p className={styles.lead}>
              Không bắt buộc. Có mục tiêu thì trang Hôm nay hiện dòng mục tiêu và số tuần tới ngày thi. Sửa lúc nào cũng được ở trang Tiến độ.
            </p>
            <div className={styles.fields}>
              <Select label="Band muốn đạt" options={BAND_OPTIONS} value={band} onChange={(value) => setBand(value)} />
              <div className={styles.dateField}>
                <label htmlFor={dateId} className={styles.label}>Ngày thi dự kiến</label>
                <input
                  id={dateId}
                  type="date"
                  className={styles.dateInput}
                  value={examDate}
                  onChange={(event) => setExamDate(event.target.value)}
                  aria-describedby={`${dateId}-hint`}
                />
                <p id={`${dateId}-hint`} className={styles.hint}>Để trống nếu chưa có ngày thi.</p>
              </div>
            </div>
            {goalError ? (
              <Notice kind="error" live="alert" className={styles.notice}>Chưa lưu được mục tiêu. Thử lại, hoặc bấm “Để sau”.</Notice>
            ) : null}
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => void saveGoal(inClass)} loading={busy} loadingLabel="Đang lưu…">Tiếp tục</Button>
              <Button variant="secondary" onClick={() => (inClass ? void finish(ASSIGNED) : setStep(3))} disabled={busy}>Để sau</Button>
              <Button variant="text" onClick={() => setStep(1)} disabled={busy}>Quay lại</Button>
            </div>
          </section>
        ) : null}

        {step === 3 && !inClass ? (
          <section aria-labelledby="start-step-title">
            <h1 id="start-step-title" ref={headingRef} tabIndex={-1} className={styles.title}>Bạn bắt đầu từ đâu?</h1>
            <p className={styles.lead}>Chọn đúng trường hợp của bạn. Chúng tôi đã chọn sẵn theo tài khoản; đổi được.</p>
            <ChoiceGroup
              mode="single"
              legend="Điểm bắt đầu"
              options={choices}
              value={start}
              onChange={(value) => setStart(value as Start)}
            />
            <div className={styles.actions}>
              {start === 'code' && ACTIVATE ? (
                <Button variant="primary" onClick={() => void finish(ACTIVATE)} loading={busy}>Nhập mã kích hoạt</Button>
              ) : null}
              {start === 'online' ? (
                <Button variant="primary" onClick={() => void finish(COURSE ?? HOME)} loading={busy}>
                  {COURSE ? 'Vào khoá học' : 'Vào trang chính'}
                </Button>
              ) : null}
              {start === 'none' ? (
                <>
                  {COURSES ? <Button variant="primary" onClick={() => void finish(COURSES)} loading={busy}>Xem các khoá</Button> : null}
                  {LIBRARY ? <Button variant={COURSES ? 'secondary' : 'primary'} onClick={() => void finish(LIBRARY)} loading={busy}>Đọc Thư viện</Button> : null}
                </>
              ) : null}
              <Button variant="text" onClick={() => void finish(HOME)} disabled={busy}>Để sau, vào trang chính</Button>
              <Button variant="text" onClick={() => setStep(2)} disabled={busy}>Quay lại</Button>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
