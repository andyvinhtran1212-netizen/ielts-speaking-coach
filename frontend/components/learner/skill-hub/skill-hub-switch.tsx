'use client';

// Chooses the tree for /speaking, /writing/dashboard and /listening
// (LEARNERCORE-0063 FR-111). Flag off, still unknown, or `?view=all`: the page
// as it is today, unchanged. Flag on: the skill hub, loaded lazily so its CSS
// and request never reach the old tree. `?view=all` keeps the old page (the
// topic chooser, the Writing editor and lists) reachable from the hub's
// "Tất cả đề" and "Xem tất cả bài đã làm" links.
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

import { wantsClassicView, type Skill } from '@/lib/skill-hub-model.mjs';

import { useLearnerV2, useLocationSearch } from './use-learner-v2';

const SkillHub = dynamic(() => import('./skill-hub').then((m) => m.SkillHub), { ssr: false });

export function SkillHubSwitch({ skill, children }: { skill: Skill; children: ReactNode }) {
  const { state, accountId } = useLearnerV2();
  const search = useLocationSearch();
  if (state === 'on' && accountId && !wantsClassicView(search)) {
    return <SkillHub skill={skill} accountId={accountId} />;
  }
  return <>{children}</>;
}
