'use client';

// "Bài được giao" v2 (LEARNERCORE-0063 amendment 3, FR-095…FR-099, FR-102),
// sheet thiet-ke/LoTrinhBaiDuocGiao.dc.html. Drawn at /course/assigned only
// when `learnerV2Enabled(me)` (`assigned-tree-switch.tsx` loads this module
// lazily, so the legacy `MyClassWorkspace` gets no new CSS or request).
//
// - One `GET /api/student/assigned` on entry (FR-095). The server decides each
//   row's `group`, `action`, `accepting` and `self_practice_available`; the
//   page never derives the hand-in rule from the deadline (FR-099).
// - Rows open through `openClassAssignment`, the code `/my-class` uses, so the
//   targets are the old tree's (FR-097). "Tự luyện bài này" asks
//   `POST …/self-practice` for the public launch (FR-100).
// - Filters run in the browser and live in `?skill=` / `?state=` (FR-098).
// - Data is owned by the account that loaded it: the next load, an account
//   change or unmount aborts a load, and a stale answer is never drawn.
//
// The layout keeps the legacy CSS (a server component cannot read the flag);
// the G03 components set their own colours, as on the Today page.
import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageState } from '@/components/ui/page-state';
import { Select } from '@/components/ui/select';
import { liveHref } from '@/components/ui/shell/learner-sections';
import { getBrowserJson } from '@/lib/browser-api';
import { openClassAssignment } from '@/lib/class-assignment-open';
import { assignedCardLabel } from '@/lib/course-hub-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import {
  ACTION_LABELS,
  STALE_NOTE,
  ALL,
  GROUPS,
  applyFilters,
  bandCopy,
  filtersSearch,
  isFiltering,
  lateCopy,
  normalizeAssigned,
  openCount,
  readFilters,
  resultLine,
  skillLabel,
  skillOptions,
  sortGroup,
  stateOptions,
  statusCopy,
  vnDateTime,
  type Assigned,
  type AssignedItem,
  type Filters,
} from './assigned-v2-model';
import { openSelfPractice, selfPracticeError } from './assigned-v2-open';
import styles from './assigned-v2.module.css';

const CLASS_HREF = liveHref({ href: '/course/class', today: null });
const ACTIVATE_HREF = liveHref({ href: '/activate', today: null });

const OVERDUE_NOTE = 'Giáo viên vẫn nhận bài nộp trễ đến ngày ghi ở từng bài. Bài nộp sau hạn được ghi "Nộp trễ" kèm số ngày.';
const REPRACTICE_NOTE = 'Bài trong khoá luyện lại không phải bài được giao: không có hạn nộp, không vào danh sách bài được giao. '
  + 'Bài Writing vẫn được AI chấm, giáo viên duyệt rồi trả; Speaking AI chấm, trả ngay. Cả hai dùng lượt lớp cấp cho bạn kèm mã.';
const GRADING_STEPS = [
  'Bạn nộp bài trước hạn.',
  'AI chấm Writing, Speaking; Listening, Reading, từ vựng và ngữ pháp chấm tự động.',
  'Giáo viên xem lại điểm và nhận xét. Bài Writing: giáo viên duyệt rồi mới trả; Speaking: AI chấm, trả ngay.',
  'Kết quả trả về, bạn nhận thông báo.',
];

type Phase =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; assigned: Assigned; owner: string };

function Row({ entry, opening, onOpen }: {
  entry: AssignedItem; opening: string | null; onOpen: (entry: AssignedItem) => void;
}) {
  const { row } = entry;
  const due = vnDateTime(row.assignment.dueAt);
  const submitted = vnDateTime(row.submittedAt);
  const late = lateCopy(row);
  const band = bandCopy(entry);
  const label = entry.action === 'none' ? null : ACTION_LABELS[entry.action];
  return (
    <li className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.skill}>{skillLabel(row.assignment.skill)}</span>
        <span className={styles.title}>{row.assignment.title}</span>
        <span className={styles.meta}>
          <span className={entry.group === 'overdue' ? styles.overdue : styles.state}>{statusCopy(entry)}</span>
          {submitted ? <span> · nộp {submitted}</span> : null}
          {band ? <span> · {band}</span> : null}
          {late ? <span className={styles.late}>{late}</span> : null}
        </span>
        <span className={styles.meta}>{due ? `Hạn ${due}` : 'Không có hạn nộp'}</span>
      </div>
      {label ? (
        <Button
          variant="secondary"
          size="sm"
          className={styles.action}
          loading={opening === row.itemId}
          loadingLabel="Đang mở…"
          onClick={() => onOpen(entry)}
        >
          {label}
        </Button>
      ) : null}
    </li>
  );
}

function Groups({ items, opening, onOpen }: {
  items: readonly AssignedItem[]; opening: string | null; onOpen: (entry: AssignedItem) => void;
}) {
  return (
    <>
      {GROUPS.map(({ key, label }) => {
        const rows = sortGroup(key, items.filter((entry) => entry.group === key));
        if (!rows.length) return null;
        return (
          <section key={key} className={styles.group} aria-label={label}>
            <h2 className={styles.groupTitle}>{label} · {rows.length}</h2>
            {key === 'overdue' ? (
              <Notice kind="warning" title={`Quá hạn · ${rows.length} bài chưa nộp`} live="none">{OVERDUE_NOTE}</Notice>
            ) : null}
            <ul className={styles.list}>
              {rows.map((entry) => <Row key={entry.row.itemId} entry={entry} opening={opening} onOpen={onOpen} />)}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function Work({ assigned, filters, onFilters, opening, onOpen }: {
  assigned: Assigned; filters: Filters; onFilters: (filters: Filters) => void;
  opening: string | null; onOpen: (entry: AssignedItem) => void;
}) {
  const { items } = assigned;
  if (!items.length) {
    return (
      <section className={styles.group} aria-label="Bài được giao">
        <p className={styles.empty}>Giáo viên chưa giao bài nào cho lớp của bạn.</p>
      </section>
    );
  }
  const shown = applyFilters(items, filters);
  const filtering = isFiltering(filters);
  const clear = () => onFilters({ skill: ALL, state: ALL });
  return (
    <>
      <div className={styles.filters} role="group" aria-label="Lọc bài được giao">
        <Select label="Kỹ năng" options={skillOptions(items)} value={filters.skill}
          onChange={(skill) => onFilters({ ...filters, skill })} className={styles.filter} />
        <Select label="Trạng thái" options={stateOptions(items)} value={filters.state}
          onChange={(state) => onFilters({ ...filters, state })} className={styles.filter} />
        <p className={styles.meta} aria-live="polite">
          {resultLine(shown.length, items.length, filtering)}
          {filtering ? <> · <button type="button" className={styles.clear} onClick={clear}>Bỏ lọc</button></> : null}
        </p>
      </div>
      {shown.length ? <Groups items={shown} opening={opening} onOpen={onOpen} /> : (
        <section className={styles.group} aria-label="Không có bài nào khớp bộ lọc">
          <p className={styles.groupTitle}>Không có bài nào khớp bộ lọc</p>
          <p className={styles.meta}>Thử chọn kỹ năng khác, hoặc bỏ lọc để xem cả {items.length} bài.</p>
          <Button variant="secondary" size="sm" onClick={clear}>Bỏ lọc</Button>
        </section>
      )}
    </>
  );
}

function Repractice({ assigned }: { assigned: Assigned }) {
  // FR-102: G04's class-source re-practice grants; empty (or not shipped) → hidden.
  if (assigned.degraded.has('repractice') || !assigned.repractice.length) return null;
  return (
    <section className={styles.group} aria-label="Khoá được cấp quyền luyện lại">
      <h2 className={styles.groupTitle}>Khoá được cấp quyền luyện lại</h2>
      <ul className={styles.list}>
        {assigned.repractice.map((grant) => <li key={grant.key} className={styles.row}><span className={styles.title}>{grant.title}</span></li>)}
      </ul>
      <p className={styles.meta}>{REPRACTICE_NOTE}</p>
    </section>
  );
}

function Grading() {
  return (
    <section className={styles.group} aria-label="Bài của lớp được chấm thế nào">
      <h2 className={styles.groupTitle}>Bài của lớp được chấm thế nào</h2>
      <ol className={styles.steps}>
        {GRADING_STEPS.map((step) => <li key={step}>{step}</li>)}
      </ol>
    </section>
  );
}

export function AssignedV2({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [filters, setFilters] = useState<Filters>({ skill: ALL, state: ALL });
  const [opening, setOpening] = useState<string | null>(null);
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  const openingRef = useRef<string | null>(null);
  const loadRef = useRef<AbortController | null>(null);
  // Unmounted (account switch remounts by key, or the learner left): every
  // pending load and open is stale, so nothing navigates or creates a session.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; loadRef.current?.abort(); };
  }, []);
  // Back from the player can restore this page from the bfcache with the
  // open lock still held; release it so every button works again.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      openingRef.current = null;
      setOpening(null);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const load = useCallback(async () => {
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    const owner = accountId;
    const stale = () => controller.signal.aborted || accountRef.current !== owner;
    setPhase({ kind: 'loading' });
    const ok = await whenGlobalReady(() => typeof window.api?.getWith === 'function', 'window.api (assigned)');
    if (stale()) return;
    if (!ok) { setPhase({ kind: 'error' }); return; }
    try {
      const raw: unknown = await getBrowserJson('/api/student/assigned', undefined, controller.signal);
      if (stale()) return;
      const assigned = normalizeAssigned(raw);
      if (!assigned) { setPhase({ kind: 'error' }); return; }
      setFilters(readFilters(window.location.search, assigned.items));
      setPhase({ kind: 'ready', assigned, owner });
    } catch {
      if (!stale()) setPhase({ kind: 'error' });
    }
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  const owned = phase.kind === 'ready' && phase.owner === accountId ? phase.assigned : null;

  const changeFilters = useCallback((next: Filters) => {
    setFilters(next);
    // FR-098: a reload keeps the choice. Same route, so no navigation.
    const search = filtersSearch(window.location.search, next);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
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

  const count = useMemo(() => (owned && !owned.degraded.has('items') ? openCount(owned.items) : 0), [owned]);

  let body: React.ReactNode;
  if (phase.kind === 'error' || owned?.degraded.has('items')) {
    // A failed read is never an empty "no work" answer (FR-103).
    body = (
      <>
        <Notice kind="error" title="Chưa tải được bài được giao." live="alert"
          action={<Button variant="secondary" size="sm" onClick={() => void load()}>Thử tải lại</Button>}>
          Bài bạn đã nộp không mất.
        </Notice>
        {owned ? <Repractice assigned={owned} /> : null}
      </>
    );
  } else if (!owned) {
    body = <PageState kind="loading" title="Đang tải bài được giao…" />;
  } else if (!owned.hasClass) {
    body = (
      <section className={styles.group} aria-label="Bài được giao">
        <p className={styles.empty}>
          Bạn chưa vào lớp nào. Bài được giao chỉ có ở lớp offline: giáo viên hoặc admin cấp mã để bạn vào khoá của lớp.
        </p>
        {ACTIVATE_HREF ? <Button href={ACTIVATE_HREF} variant="secondary" size="sm">Nhập mã kích hoạt của lớp</Button> : null}
      </section>
    );
  } else {
    body = (
      <>
        {owned.stale ? <Notice kind="info" live="none">{STALE_NOTE}</Notice> : null}
        <Work assigned={owned} filters={filters} onFilters={changeFilters} opening={opening}
          onOpen={(entry) => void open(entry)} />
        <Repractice assigned={owned} />
        <Grading />
      </>
    );
  }

  return (
    <div className={`av2-root ${styles.page}`}>
      <main className={styles.main} aria-busy={!owned && phase.kind !== 'error' ? true : undefined}>
        <header className={styles.header}>
          <h1 className={styles.heading}>Lộ trình</h1>
          <p className={styles.lead}>
            Khoá online bạn đã đăng ký và khoá của lớp do giáo viên cấp mã, xếp thành hai nhóm. Bài giáo viên
            giao cho lớp nằm ở thẻ bên cạnh.
          </p>
        </header>
        <nav className={styles.cards} aria-label="Lộ trình">
          <a className={styles.card} href="/course">Các khoá và bài học</a>
          <a className={styles.card} href="/course/assigned" aria-current="page">{assignedCardLabel(count)}</a>
          {owned?.hasClass && CLASS_HREF ? <a className={styles.card} href={CLASS_HREF}>Buổi học và tài liệu lớp</a> : null}
        </nav>
        {body}
      </main>
    </div>
  );
}

export default AssignedV2;
