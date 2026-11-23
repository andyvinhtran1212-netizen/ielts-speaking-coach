'use client';

// One skill hub (LEARNERCORE-0063 T25, tờ HubKyNang), used by /speaking,
// /writing/dashboard, /listening and /reading when learner_v2 is on.
//
// - One `GET /api/student/skill-hub?skill=` on entry (FR-118).
// - Four blocks in a fixed order: Làm tiếp, Gợi ý cho bạn, Kho bài luyện,
//   Lịch sử và kết quả gần đây. Each reads its own `degraded` flag: a broken
//   part fails only its block, with "Thử lại" (FR-118).
// - "Hết lượt" only for `metering = metered` and `total = 0`; `not_metered`
//   and `unknown` never say so (FR-116, HOLD patch).
// - "Kỹ năng chưa có trong khoá của bạn" only when the server blocks the skill
//   (FR-117); today it never does.
// - Links come from the server (relative paths) or `liveHref`, never built here.
import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageState } from '@/components/ui/page-state';
import { liveHref } from '@/components/ui/shell/learner-sections';
import { resolveCorePlayerAdmissionForNavigation } from '@/lib/core-player-affinity.mjs';
import {
  SKILLS,
  SKILL_HUB_HREFS,
  SKILL_LABELS,
  catalogMetaCopy,
  creditsEmpty,
  hrefPath,
  normalizeSkillHub,
  resultCopy,
  sourceCopy,
  vnDateCopy,
  type Skill,
  type SkillHub as Hub,
  type SkillHubBlock,
  type SkillHubStarter,
} from '@/lib/skill-hub-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import { CreditsEmptyNotice } from './credits-empty-notice';
import styles from './skill-hub.module.css';

type Phase = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; hub: Hub };

const PRACTICE = liveHref({ href: '/practice', today: null });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.block} aria-label={title}>
      <h2 className={styles.blockTitle}>{title}</h2>
      {children}
    </section>
  );
}

function BlockError({ onRetry }: { onRetry: () => void }) {
  return (
    <Notice
      kind="warning"
      title="Chưa tải được phần này."
      live="none"
      action={<Button variant="secondary" size="sm" onClick={onRetry}>Thử lại</Button>}
    >
      Các phần khác vẫn dùng được.
    </Notice>
  );
}

function SkillTabs({ skill }: { skill: Skill }) {
  return (
    <nav aria-label="Kỹ năng" className={styles.tabs}>
      {SKILLS.map((s) => {
        const href = SKILL_HUB_HREFS[s];
        if (!liveHref({ href: hrefPath(href), today: null })) return null;
        return (
          <a key={s} href={href} className={styles.tab} aria-current={s === skill ? 'page' : undefined}>
            {SKILL_LABELS[s]}
          </a>
        );
      })}
    </nav>
  );
}

// A Speaking starter opens its session here, the same way the class page
// does (POST /sessions, then the Speaking admission); the others follow href.
function StarterButton({ starter }: { starter: SkillHubStarter }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const params = starter.sessionParams;
  if (!params) return <Button href={starter.href} variant="primary" size="sm">Bắt đầu</Button>;
  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const created = await window.api.post<unknown>('/sessions', params);
      const session = created && typeof created === 'object' ? created as Record<string, unknown> : null;
      const id = typeof session?.id === 'string' && session.id.trim() ? session.id.trim()
        : typeof session?.session_id === 'string' && session.session_id.trim() ? session.session_id.trim() : '';
      if (!id) throw new Error('Máy chủ không trả về buổi học hợp lệ.');
      const destination = await resolveCorePlayerAdmissionForNavigation('speaking', { session_id: id });
      if (destination.startsWith('/practice/session?')) router.push(destination);
      else window.location.assign(destination);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      window.showToast?.(`Không mở được bài: ${message}`, 'error', { timeout: 6000 });
      setBusy(false);
    }
  };
  return (
    <Button variant="primary" size="sm" onClick={() => { void start(); }} disabled={busy}>
      {busy ? 'Đang mở…' : 'Bắt đầu'}
    </Button>
  );
}

function Resume({ hub, onRetry }: { hub: Hub; onRetry: () => void }) {
  if (hub.degraded.has('resume')) return <Section title="Làm tiếp"><BlockError onRetry={onRetry} /></Section>;
  if (hub.resume.length) {
    return (
      <Section title="Làm tiếp">
        <ul className={styles.list}>
          {hub.resume.map((item) => (
            <li key={item.href} className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.itemTitle}>{item.title}</span>
                <span className={styles.meta}>
                  {item.state === 'draft' ? 'Bản nháp chưa nộp' : 'Đang làm dở'}
                  {vnDateCopy(item.updatedAt) ? ` · ${vnDateCopy(item.updatedAt)}` : ''}
                </span>
              </div>
              <Button href={item.href} variant="secondary" size="sm">Làm tiếp</Button>
            </li>
          ))}
        </ul>
      </Section>
    );
  }
  if (!hub.starter) return null;
  return (
    <Section title="Bắt đầu với một bài">
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.itemTitle}>{hub.starter.title}</span>
          {hub.starter.meta ? <span className={styles.meta}>{hub.starter.meta}</span> : null}
          {hub.starter.usesCredit ? <span className={styles.meta}>Nộp bài để AI chấm sẽ dùng 1 lượt.</span> : null}
        </div>
        <StarterButton starter={hub.starter} />
      </div>
    </Section>
  );
}

function Suggestions({ hub, onRetry }: { hub: Hub; onRetry: () => void }) {
  if (hub.degraded.has('suggestions')) {
    return <Section title="Gợi ý cho bạn"><BlockError onRetry={onRetry} /></Section>;
  }
  if (!hub.suggestions.length) return null;
  return (
    <Section title="Gợi ý cho bạn">
      <ul className={styles.list}>
        {hub.suggestions.map((s, index) => (
          <li key={`${s.kind}-${index}`} className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.itemTitle}>{s.title}</span>
              {s.why ? <span className={styles.meta}>{s.why}</span> : null}
            </div>
            <Button href={s.href} variant="secondary" size="sm">Mở</Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Catalog({ hub, onRetry }: { hub: Hub; onRetry: () => void }) {
  const label = SKILL_LABELS[hub.skill];
  if (hub.degraded.has('catalog')) return <Section title="Kho bài luyện"><BlockError onRetry={onRetry} /></Section>;
  return (
    <Section title="Kho bài luyện">
      {hub.catalog.length ? (
        <ul className={styles.grid}>
          {hub.catalog.map((g) => (
            <li key={g.group}>
              <a href={g.href} className={styles.card}>
                <span className={styles.itemTitle}>{g.label}</span>
                {catalogMetaCopy(g) ? <span className={styles.meta}>{catalogMetaCopy(g)}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {hub.catalogHref ? <a href={hub.catalogHref} className={styles.link}>Tất cả đề {label} ›</a> : null}
    </Section>
  );
}

function History({ hub, onRetry }: { hub: Hub; onRetry: () => void }) {
  const label = SKILL_LABELS[hub.skill];
  const title = 'Lịch sử và kết quả gần đây';
  if (hub.degraded.has('history')) return <Section title={title}><BlockError onRetry={onRetry} /></Section>;
  if (!hub.history.length) {
    return (
      <Section title={title}>
        <p className={styles.meta}>
          Bạn chưa nộp bài {label} nào. Bài đầu tiên bạn nộp sẽ hiện ở đây cùng kết quả.
        </p>
      </Section>
    );
  }
  return (
    <Section title={title}>
      <ul className={styles.list}>
        {hub.history.map((h, index) => {
          const result = resultCopy(h.result);
          const facts = [vnDateCopy(h.submittedAt), h.kind, sourceCopy(h.source)].filter(Boolean);
          return (
            <li key={`${h.href ?? h.title}-${index}`} className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.itemTitle}>{h.title}</span>
                <span className={styles.meta}>{facts.join(' · ')}</span>
                {result ? <span className={styles.result}>{result}</span> : null}
              </div>
              {h.href ? <Button href={h.href} variant="text" size="sm">Xem phiếu</Button> : null}
            </li>
          );
        })}
      </ul>
      {hub.historyHref ? <a href={hub.historyHref} className={styles.link}>Xem tất cả bài đã làm ›</a> : null}
    </Section>
  );
}

function CreditsLine({ hub }: { hub: Hub }) {
  if (hub.skill !== 'speaking' && hub.skill !== 'writing') return null;
  if (creditsEmpty(hub.credits)) return <CreditsEmptyNotice />;
  if (!hub.credits) return null;
  return <p className={styles.meta}>Lượt chấm AI còn lại: <strong className={styles.number}>{hub.credits.total}</strong></p>;
}

export function SkillHub({ skill, accountId }: { skill: Skill; accountId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  const label = SKILL_LABELS[skill];

  const load = useCallback(async () => {
    const owner = accountId;
    setPhase({ kind: 'loading' });
    const ok = await whenGlobalReady(() => typeof window.api?.get === 'function', 'window.api (skill hub)');
    if (accountRef.current !== owner) return;
    if (!ok) { setPhase({ kind: 'error' }); return; }
    try {
      const raw = await window.api.get<unknown>(`/api/student/skill-hub?skill=${encodeURIComponent(skill)}`);
      if (accountRef.current !== owner) return;
      const hub = normalizeSkillHub(raw, skill);
      setPhase(hub ? { kind: 'ready', hub } : { kind: 'error' });
    } catch {
      if (accountRef.current !== owner) return;
      setPhase({ kind: 'error' });
    }
  }, [accountId, skill]);

  useEffect(() => { void load(); }, [load]);
  const retry = useCallback(() => { void load(); }, [load]);

  let body: React.ReactNode;
  if (phase.kind === 'loading') {
    body = <PageState kind="loading" title={`Đang tải ${label}`} />;
  } else if (phase.kind === 'error') {
    body = (
      <Notice
        kind="error"
        title={`Chưa tải được trang ${label}.`}
        live="alert"
        action={<Button variant="secondary" size="sm" onClick={retry}>Thử lại</Button>}
      />
    );
  } else if (phase.hub.blocked) {
    body = (
      <PageState
        kind="locked"
        title="Kỹ năng chưa có trong khoá của bạn"
        body={`Khoá học hiện tại của bạn chưa gồm chấm bài ${label}.`}
      />
    );
  } else {
    const hub = phase.hub;
    body = (
      <>
        <Resume hub={hub} onRetry={retry} />
        <Suggestions hub={hub} onRetry={retry} />
        <Catalog hub={hub} onRetry={retry} />
        <History hub={hub} onRetry={retry} />
      </>
    );
  }

  const crumbs = PRACTICE
    ? [{ label: 'Luyện tập', href: PRACTICE }, { label }]
    : [];
  return (
    <div className={styles.page} data-skill-hub={skill}>
      <main className={styles.main}>
        <header className={styles.header}>
          {crumbs.length ? <Breadcrumb items={crumbs} /> : null}
          <h1 className={styles.heading}>{label}</h1>
          <SkillTabs skill={skill} />
          {phase.kind === 'ready' ? <CreditsLine hub={phase.hub} /> : null}
        </header>
        {body}
      </main>
    </div>
  );
}

export type { SkillHubBlock };
