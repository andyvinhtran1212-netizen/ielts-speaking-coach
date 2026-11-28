'use client';

// Luyện tập `/practice` (LEARNERCORE-0063 amendment 1, FR-079). One read of
// `GET /api/student/today?view=resume` for its `resume` part (same rule as FR-023; no new
// API), then exactly four skill cards in the order Speaking · Writing ·
// Listening · Reading. The cards are drawn whatever the read does and never
// show a band or a credit count. Writes nothing.
//
// Data is owned by the account that loaded it (same rule as Today, HOLD
// 10:28Z on #2543): a load is aborted by the next load, an account change or
// unmount, and a stale answer is never drawn.
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { liveHref } from '@/components/ui/shell/learner-sections';
import { getBrowserJson } from '@/lib/browser-api';
import { normalizeTodayResume, resumeKindCopy, type TodayResume } from '@/lib/today-v2-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import styles from './practice-hub.module.css';

/** FR-079: the four skill hubs, in this order; a hub that is not live is not drawn. */
export const SKILL_CARDS: ReadonlyArray<{ skill: string; title: string; href: string; lead: string }> = [
  { skill: 'speaking', title: 'Speaking', href: '/speaking', lead: 'Luyện nói Part 1, 2, 3.' },
  { skill: 'writing', title: 'Writing', href: '/writing/dashboard', lead: 'Viết Task 1 và Task 2.' },
  { skill: 'listening', title: 'Listening', href: '/listening', lead: 'Luyện nghe và làm đề.' },
  { skill: 'reading', title: 'Reading', href: '/reading', lead: 'Luyện đọc và làm đề.' },
];

type Phase =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; resume: TodayResume[]; degraded: boolean; owner: string };

function ResumeBlock({ phase, owned, onRetry }: {
  phase: Phase; owned: Extract<Phase, { kind: 'ready' }> | null; onRetry: () => void;
}) {
  if (phase.kind === 'error' || owned?.degraded) {
    return (
      <section className={styles.block} aria-label="Làm tiếp">
        <h2 className={styles.blockTitle}>Làm tiếp</h2>
        <Notice kind="warning" title="Chưa tải được bài đang làm" live="status"
          action={<Button variant="secondary" size="sm" onClick={onRetry}>Thử lại</Button>} />
      </section>
    );
  }
  // Still loading, or nothing in progress: the block is not drawn.
  if (!owned || !owned.resume.length) return null;
  return (
    <section className={styles.block} aria-label="Làm tiếp">
      <h2 className={styles.blockTitle}>Làm tiếp</h2>
      <ul className={styles.list}>
        {owned.resume.map((item) => (
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
    </section>
  );
}

export function PracticeHubPage({ accountId }: { accountId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  const loadRef = useRef<AbortController | null>(null);
  useEffect(() => () => { loadRef.current?.abort(); }, []);

  const load = useCallback(async () => {
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    const owner = accountId;
    const stale = () => controller.signal.aborted || accountRef.current !== owner;
    setPhase({ kind: 'loading' });
    const ok = await whenGlobalReady(() => typeof window.api?.getWith === 'function', 'window.api (practice)');
    if (stale()) return;
    if (!ok) { setPhase({ kind: 'error' }); return; }
    try {
      const raw = await getBrowserJson('/api/student/today', new URLSearchParams({ view: 'resume' }), controller.signal);
      if (stale()) return;
      const resume = normalizeTodayResume(raw);
      if (!resume) { setPhase({ kind: 'error' }); return; }
      setPhase({ kind: 'ready', ...resume, owner });
    } catch {
      if (stale()) return;
      setPhase({ kind: 'error' });
    }
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  const owned = phase.kind === 'ready' && phase.owner === accountId ? phase : null;
  const cards = SKILL_CARDS.flatMap((card) => {
    const href = liveHref({ href: card.href, today: null });
    return href ? [{ ...card, href }] : [];
  });

  return (
    <main className={styles.main} aria-busy={phase.kind === 'loading' ? true : undefined}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Luyện tập</h1>
        <p className={styles.lead}>Chọn một kỹ năng để luyện. Bài đang làm dở hiện ở trên cùng.</p>
      </header>
      <ResumeBlock phase={phase} owned={owned} onRetry={() => void load()} />
      <section className={styles.block} aria-label="Kỹ năng">
        <h2 className={styles.blockTitle}>Kỹ năng</h2>
        <ul className={styles.cards}>
          {cards.map((card) => (
            <li key={card.skill}>
              <a className={styles.card} href={card.href} data-skill={card.skill}>
                <span className={styles.cardTitle}>{card.title}</span>
                <span className={styles.meta}>{card.lead}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
