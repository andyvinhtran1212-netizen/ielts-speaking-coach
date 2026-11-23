// `/reading` (LEARNERCORE-0063 FR-111). It used to `redirect('/reading/vocab')`
// on the server. The flag lives in the client-side `/auth/me` profile, so the
// choice now happens in `ReadingHubEntry`: learner_v2 on → the Reading hub;
// off → `router.replace('/reading/vocab')`, query kept.
import type { Metadata } from 'next';

import { ReadingHubEntry } from '@/components/learner/skill-hub/reading-hub-entry';

export const metadata: Metadata = {
  title: 'Reading — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ReadingEntryPage() {
  return (
    <>
      {/* Chrome chung: nó nạp hồ sơ /auth/me mà cờ learner_v2 đọc. */}
      {/* @ts-ignore */}
      <aver-chrome active="reading" />
      <ReadingHubEntry />
    </>
  );
}
