'use client';

import type { ReactNode } from 'react';

import { Icon } from '@/components/ui';
import { useLearnerShellPanel } from '@/components/ui/shell/learner-panel';
import { LearnerShell, type LearnerShellProps } from '@/components/ui/shell/learner-shell';
import type { LookupGroup } from '@/components/ui/shell/quick-lookup';

import styles from './ui-library.module.css';

// Sample data of KhungTrang §1 (UIBASE-0056 G03-T14). Never real accounts or
// figures: credits stay PendingValue-style placeholders where the sheet has XXX.
export const SAMPLE_ADMIN = { name: 'Vũ Thu Trang', email: 'thutrang@example.com', initials: 'VT' };
export const SAMPLE_LEARNER = { name: 'Trần Quốc Bảo', email: 'quocbao@example.com', initials: 'QB' };

const SAMPLE_LOOKUP: readonly LookupGroup[] = [
  { group: 'vocabulary', items: [{ title: 'agree', meta: 'động từ · đồng ý', href: '/vocabulary' }] },
  { group: 'grammar', items: [{ title: 'Sự hoà hợp chủ ngữ và động từ', meta: 'Subject–verb agreement', href: '/grammar' }] },
  { group: 'writing', items: [{ title: 'Task 2 — Working from home', meta: 'agree or disagree · 3 bài mẫu', href: '/writing/dashboard' }] },
];

/** Sample lookup: matches on the first letters, like the sheet's "agree". */
export async function sampleLookup(query: string): Promise<readonly LookupGroup[]> {
  const q = query.toLowerCase();
  return 'agree'.startsWith(q) || q.startsWith('agree') ? SAMPLE_LOOKUP : [];
}

export type BellState = 'none' | 'unread' | 'overdue';

/**
 * Sample bell of the sheet's three states (KhungTrang §1). The real one is
 * G11-T11's; it joins the shell's one-open-at-a-time rule the same way.
 */
export function SampleBell({ unread = 0 }: { unread?: number }) {
  const [open, setOpen] = useLearnerShellPanel('notifications');
  const label = unread > 0 ? `Thông báo, ${unread > 9 ? '9+' : unread} chưa đọc` : 'Thông báo';
  return (
    <span className={styles.bellWrap}>
      <button type="button" className={styles.bell} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="bell" />
        {unread > 0 ? <span className={styles.bellCount} aria-hidden="true">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {open ? <span className={styles.bellPanel} role="dialog" aria-label="Thông báo">Ngăn thông báo (G11-T11)</span> : null}
    </span>
  );
}

export function SampleOverdue({ count }: { count: number }) {
  return <a href="/home" className={styles.overdue}>{count} quá hạn</a>;
}

type DemoProps = Partial<Omit<LearnerShellProps, 'children'>> & { children?: ReactNode };

/** LearnerShell with the sheet's sample data, section "Luyện tập" (acceptance scenario 3). */
export function LearnerShellDemo({ children, ...props }: DemoProps) {
  return (
    <LearnerShell
      user={SAMPLE_ADMIN}
      canSwitchToAdmin
      credits={{ remaining: null, low: false }}
      overdueSlot={<SampleOverdue count={3} />}
      notificationsSlot={<SampleBell unread={2} />}
      lookup={sampleLookup}
      demo={{ section: 'practice' }}
      {...props}
    >
      {children ?? <p className={styles.demoContent}>[Nội dung trang]</p>}
    </LearnerShell>
  );
}
