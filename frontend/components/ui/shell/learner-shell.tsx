'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { sectionFor } from '@/lib/route-registry.mjs';

import type { LearnerUser } from './account-menu';
import type { AiCredits } from './ai-credits';
import { BottomTabBar } from './bottom-tab-bar';
import { CompactFooter } from './compact-footer';
import { LearnerPanelProvider } from './learner-panel';
import { LEARNER_NAV, type LearnerSectionId } from './learner-sections';
import { LearnerTopNav } from './learner-top-nav';
import type { LookupFn } from './quick-lookup';
import styles from './learner-shell.module.css';

export type LearnerShellProps = {
  user: LearnerUser;
  /** From the server profile (`/auth/me`); true only for admins. */
  canSwitchToAdmin: boolean;
  /** From the server profile; true for instructors and admins (LEARNERNAV-0062 FR-003). */
  canSwitchToInstructor?: boolean;
  /** One shared AI credit count; `remaining: null` → PendingValue; not passed → hidden. */
  credits?: AiCredits | null;
  /** Account without a course (FR-016): "Chấm thử hôm nay còn N bài". */
  trialLeft?: number | null;
  /** G11-T11's bell; joins the one-open-at-a-time rule via useLearnerShellPanel('notifications'). */
  notificationsSlot?: ReactNode;
  /** G11-T11's "N quá hạn" chip. */
  overdueSlot?: ReactNode;
  /** G06 wires the data; without it there is no magnifier. */
  lookup?: LookupFn;
  /**
   * /ui-library and tests only: show this section instead of the pathname's,
   * and render the content in a <div> (the library page has its own <main>).
   */
  demo?: { section: LearnerSectionId | null };
  children: ReactNode;
};

const IDS = new Set<string>(LEARNER_NAV.map((item) => item.id));

/** The current section, derived from the route registry, never written per page (FR-007). */
export function useLearnerSection(): LearnerSectionId | null {
  const section = sectionFor(usePathname() ?? '');
  return section && IDS.has(section) ? (section as LearnerSectionId) : null;
}

/**
 * Page frame for every signed-in learner page (UIBASE-0056 FR-007, FR-016,
 * plan 5.5), including accounts without a course: it mounts no activation
 * gate and calls no API. Whether a page needs the gate is its layout's call.
 */
export function LearnerShell({ demo, children, ...bar }: LearnerShellProps) {
  const fromPath = useLearnerSection();
  const current = demo ? demo.section : fromPath;
  return (
    <LearnerPanelProvider>
      <div className={styles.shell} data-demo={demo ? '' : undefined}>
        {demo ? null : <a href="#main-content" className={styles.skip}>Bỏ qua tới nội dung</a>}
        <LearnerTopNav current={current} {...bar} />
        {demo
          ? <div className={styles.main}>{children}</div>
          : <main id="main-content" tabIndex={-1} className={styles.main}>{children}</main>}
        <CompactFooter />
        <BottomTabBar current={current} />
      </div>
    </LearnerPanelProvider>
  );
}
