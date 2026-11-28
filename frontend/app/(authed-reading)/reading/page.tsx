// `/reading` (LEARNERCORE-0063 FR-111). Without `?hub=1` it is exactly what it
// was: the same server `redirect('/reading/vocab')`, for every learner,
// old link and bot (flag on or off). The Reading hub lives behind `?hub=1`,
// which only the hub's own skill tabs link to: the flag is in the client-side
// `/auth/me` profile, so `ReadingHubEntry` opens the hub when learner_v2 is on
// and otherwise falls back to the same `/reading/vocab` redirect.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ReadingHubEntry } from '@/components/learner/skill-hub/reading-hub-entry';

export const metadata: Metadata = {
  title: 'Reading — Aver Learning',
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ReadingEntryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  if (params.hub !== '1') redirect('/reading/vocab');
  return (
    <>
      {/* Chrome chung: nó nạp hồ sơ /auth/me mà cờ learner_v2 đọc. */}
      {/* @ts-ignore */}
      <aver-chrome active="reading" />
      <ReadingHubEntry />
    </>
  );
}
