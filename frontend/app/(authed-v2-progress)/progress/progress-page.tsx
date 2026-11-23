'use client';

// /progress (LEARNERCORE-0063 FR-061, FR-077, FR-087; sheet TienDo).
//
// - One row per skill: work done, latest result under FR-077, and a link to the
//   history page that already exists. Only existing APIs are read (see
//   `lib/progress-model.mjs`); each source is read on its own, so one failure
//   marks only that row. Reading has no learner history API yet, so its row
//   says so and links to the Reading page instead of showing a number.
// - Goal band and exam date are edited here and saved through
//   `PATCH /auth/profile`, the same place "Lần đầu vào" and Today use. When the
//   `profile_update` kill switch answers 503 `feature_disabled`, the two fields
//   turn read-only with a sentence saying editing is paused.
// - FR-087: when G04's `GET /api/me/courses` sends `content_visible_until`,
//   the cut-off line is shown; a 410 `content_expired` on a row says "Bài này
//   đã hết thời hạn xem." without an error code.
import { useCallback, useEffect, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { liveHref } from '@/components/ui/shell/learner-sections';
import { useLearnerMe } from '@/components/learner/learner-frame';
import { useAuth } from '@/lib/auth/auth-provider';
import { getCurrentProfile } from '@/lib/auth-api';
import { getBrowserJson, patchBrowserJsonAt } from '@/lib/browser-api';
import { contentVisibleLine, formatVnDate, normalizeMyCourses } from '@/lib/account-model.mjs';
import {
  goalFromMe,
  isContentExpired,
  isFeatureDisabled,
  listeningRow,
  speakingRow,
  vocabRow,
  writingRow,
  type SkillFacts,
} from '@/lib/progress-model.mjs';
import { START_BANDS } from '@/lib/start-flow-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import styles from './progress.module.css';

type SkillId = 'speaking' | 'writing' | 'listening' | 'vocab';
type RowState =
  | { kind: 'loading' }
  | { kind: 'ready'; facts: SkillFacts }
  | { kind: 'error'; expired: boolean };

type SkillPath = '/sessions' | '/api/writing/my-essays' | '/api/listening/overview' | '/api/quiz/progress';
type Skill = {
  id: SkillId; name: string; path: SkillPath; query: Record<string, string> | null;
  build: (raw: unknown) => SkillFacts | null; href: string | null; linkLabel: string;
};

const SKILLS: readonly Skill[] = [
  { id: 'speaking', name: 'Speaking', path: '/sessions', query: { status: 'completed', page: '1', page_size: '5' }, build: speakingRow, href: liveHref({ href: '/speaking', today: null }), linkLabel: 'Xem lịch sử Speaking' },
  { id: 'writing', name: 'Writing', path: '/api/writing/my-essays', query: null, build: writingRow, href: liveHref({ href: '/writing/dashboard', today: null }), linkLabel: 'Xem bài Writing' },
  { id: 'listening', name: 'Listening', path: '/api/listening/overview', query: null, build: listeningRow, href: liveHref({ href: '/listening', today: null }), linkLabel: 'Xem Listening' },
  { id: 'vocab', name: 'Từ vựng', path: '/api/quiz/progress', query: { skill_area: 'vocab' }, build: vocabRow, href: liveHref({ href: '/vocabulary/hub', today: null }), linkLabel: 'Xem Từ vựng' },
];
const READING = liveHref({ href: '/reading/test', today: '/reading' });

const BAND_OPTIONS = [{ value: '', label: 'Chưa đặt' }, ...START_BANDS.map((b) => ({ value: b, label: b }))];
const INITIAL_ROWS: Record<SkillId, RowState> = {
  speaking: { kind: 'loading' }, writing: { kind: 'loading' }, listening: { kind: 'loading' }, vocab: { kind: 'loading' },
};

function SkillRow({ skill, state }: { skill: Skill; state: RowState }) {
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <h3 className={styles.skill}>{skill.name}</h3>
        {state.kind === 'loading' ? <p className={styles.muted}>Đang tải…</p> : null}
        {state.kind === 'error' ? (
          <p className={styles.error}>
            {state.expired ? 'Bài này đã hết thời hạn xem.' : `Chưa tải được số liệu ${skill.name}. Tải lại trang để thử lại.`}
          </p>
        ) : null}
        {state.kind === 'ready' ? (
          <p className={styles.facts}>
            <span>{state.facts.done}</span>
            {state.facts.result ? <span className={styles.result}>Gần nhất: {state.facts.result}</span> : null}
          </p>
        ) : null}
        {state.kind === 'ready' && state.facts.warning ? <p className={styles.error}>{state.facts.warning}</p> : null}
      </div>
      {skill.href ? <a href={skill.href} className={styles.link}>{skill.linkLabel}</a> : null}
    </li>
  );
}

type GoalMode = 'edit' | 'locked';

function GoalBlock({ me }: { me: unknown }) {
  const dateId = useId();
  const [saved, setSaved] = useState(() => goalFromMe(me));
  const [band, setBand] = useState(saved.band);
  const [examDate, setExamDate] = useState(saved.examDate);
  const [mode, setMode] = useState<GoalMode>('edit');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<'saved' | 'kept' | 'reload' | 'error' | null>(null);

  // PATCH /auth/profile ignores null fields, so an emptied band or date cannot
  // be cleared there: send only real values, then show what the server holds
  // (canonical reconcile), and say so when an emptied field was kept.
  const save = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    const body: { target_band?: number; exam_date?: string } = {};
    if (START_BANDS.includes(band)) body.target_band = Number(band);
    if (/^\d{4}-\d{2}-\d{2}$/.test(examDate)) body.exam_date = examDate;
    try {
      if (Object.keys(body).length) await patchBrowserJsonAt('/auth/profile', '/auth/profile', body);
    } catch (error) {
      if (isFeatureDisabled(error)) setMode('locked');
      else setNote('error');
      setBusy(false);
      return;
    }
    try {
      const canonical = goalFromMe(await getCurrentProfile());
      const kept = (!band && !!canonical.band) || (!examDate && !!canonical.examDate);
      setSaved(canonical);
      setBand(canonical.band);
      setExamDate(canonical.examDate);
      setNote(kept ? 'kept' : 'saved');
    } catch {
      setNote('reload');
    } finally {
      setBusy(false);
    }
  }, [band, busy, examDate]);

  if (mode === 'locked') {
    return (
      <>
        <Notice kind="info" live="status" className={styles.notice}>
          Tạm khoá sửa mục tiêu để bảo trì. Bạn vẫn xem được mục tiêu đã lưu.
        </Notice>
        <dl className={styles.goalView}>
          <div><dt>Band muốn đạt</dt><dd>{saved.band || 'Chưa đặt'}</dd></div>
          <div><dt>Ngày thi dự kiến</dt><dd>{formatVnDate(saved.examDate ? `${saved.examDate}T00:00:00+07:00` : null) ?? 'Chưa đặt'}</dd></div>
        </dl>
      </>
    );
  }

  return (
    <>
      <div className={styles.fields}>
        <Select label="Band muốn đạt" options={BAND_OPTIONS} value={band} onChange={(value) => { setBand(value); setNote(null); }} />
        <div className={styles.dateField}>
          <label htmlFor={dateId} className={styles.label}>Ngày thi dự kiến</label>
          <input
            id={dateId}
            type="date"
            className={styles.dateInput}
            value={examDate}
            onChange={(event) => { setExamDate(event.target.value); setNote(null); }}
            aria-describedby={`${dateId}-hint`}
          />
          <p id={`${dateId}-hint`} className={styles.hint}>Để trống nếu chưa có ngày thi.</p>
        </div>
      </div>
      {note === 'error' ? <Notice kind="error" live="alert" className={styles.notice}>Chưa lưu được mục tiêu. Thử lại.</Notice> : null}
      {note === 'kept' ? (
        <Notice kind="warning" live="alert" className={styles.notice}>
          Mục tiêu đã lưu không bỏ trống được. Bạn có thể đổi sang band hoặc ngày khác.
        </Notice>
      ) : null}
      {note === 'reload' ? (
        <Notice kind="warning" live="alert" className={styles.notice}>
          Đã lưu, nhưng chưa tải lại được mục tiêu. Tải lại trang để xem.
        </Notice>
      ) : null}
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => void save()} loading={busy} loadingLabel="Đang lưu…">Lưu mục tiêu</Button>
        <p role="status" className={styles.muted}>{note === 'saved' ? 'Đã lưu mục tiêu.' : ''}</p>
      </div>
    </>
  );
}

/**
 * The private rows hang under a key of the signed-in account: a session change
 * or sign-out unmounts them in the same render, so another account's numbers
 * never stay on screen (late replies land in an unmounted, aborted tree).
 */
export function ProgressPage() {
  const { status, user } = useAuth();
  const accountId = status === 'signed-in' ? user?.id ?? null : null;
  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);
  if (!accountId) {
    return (
      <div className={styles.page}>
        <p role="status" className={styles.muted}>Đang tải tiến độ…</p>
      </div>
    );
  }
  return <ProgressContent key={accountId} accountId={accountId} />;
}

function ProgressContent({ accountId }: { accountId: string }) {
  const learner = useLearnerMe();
  const [rows, setRows] = useState<Record<SkillId, RowState>>(INITIAL_ROWS);
  const [visibleLine, setVisibleLine] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setRows(INITIAL_ROWS);
    setVisibleLine(null);
    (async () => {
      const ok = await whenGlobalReady(() => typeof window.api?.getWith === 'function', 'window.api (progress)');
      if (abort.signal.aborted) return;
      if (!ok) {
        setRows({
          speaking: { kind: 'error', expired: false }, writing: { kind: 'error', expired: false },
          listening: { kind: 'error', expired: false }, vocab: { kind: 'error', expired: false },
        });
        return;
      }
      const opts = { signal: abort.signal };
      await Promise.all([
        ...SKILLS.map(async (skill) => {
          let next: RowState;
          try {
            const query = skill.query ? new URLSearchParams(skill.query) : undefined;
            const facts = skill.build(await getBrowserJson(skill.path, query, abort.signal));
            next = facts ? { kind: 'ready', facts } : { kind: 'error', expired: false };
          } catch (error) {
            next = { kind: 'error', expired: isContentExpired(error) };
          }
          if (!abort.signal.aborted) setRows((prev) => ({ ...prev, [skill.id]: next }));
        }),
        (async () => {
          try {
            const courses = normalizeMyCourses(await window.api.getWith<unknown>('/api/me/courses', undefined, opts));
            if (!abort.signal.aborted) setVisibleLine(contentVisibleLine(courses));
          } catch {
            // G04 not there yet, or the read failed: no cut-off line (FR-087).
          }
        })(),
      ]);
    })();
    return () => abort.abort();
  }, [accountId]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Tiến độ</p>
        <h1 className={styles.title}>Bạn đã làm được gì</h1>
        <p className={styles.lead}>Số bài đã làm và kết quả gần nhất của từng kỹ năng.</p>
        {visibleLine ? <p className={styles.notice}>{visibleLine}</p> : null}
      </header>

      <section className={styles.section} aria-labelledby="ky-nang">
        <h2 id="ky-nang" className={styles.sectionTitle}>Theo kỹ năng</h2>
        <ul className={styles.rows}>
          {SKILLS.map((skill) => <SkillRow key={skill.id} skill={skill} state={rows[skill.id]} />)}
          <li className={styles.row}>
            <div className={styles.rowMain}>
              <h3 className={styles.skill}>Reading</h3>
              <p className={styles.muted}>Trang này chưa tổng hợp được bài Reading. Kết quả từng đề xem ở trang Reading.</p>
            </div>
            {READING ? <a href={READING} className={styles.link}>Mở Reading</a> : null}
          </li>
        </ul>
        <p className={styles.hint}>
          Band chỉ hiện khi có bài Speaking hoặc Writing đã chấm có band. Listening và Từ vựng hiện số câu đúng của lần gần nhất.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="muc-tieu">
        <h2 id="muc-tieu" className={styles.sectionTitle}>Mục tiêu</h2>
        {learner.status === 'loading' ? <p role="status" className={styles.muted}>Đang tải mục tiêu…</p> : null}
        {learner.status === 'error' ? (
          <Notice kind="error" live="alert">Chưa tải được mục tiêu đã lưu. Tải lại trang để thử lại.</Notice>
        ) : null}
        {learner.status === 'ready' && learner.me.id === accountId ? <GoalBlock key={learner.me.id} me={learner.me} /> : null}
      </section>
    </div>
  );
}
