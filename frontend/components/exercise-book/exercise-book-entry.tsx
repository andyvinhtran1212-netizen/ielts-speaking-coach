'use client';

import { useEffect, useState } from 'react';

import { ExerciseBookApiProvider, useExerciseBookApi } from '@/lib/exercise-book/api-context';
import type { ExerciseBookApi } from '@/lib/exercise-book/contract';
import { errorCode } from '@/lib/exercise-book/model';

import { adminExerciseBookHref, adminGrantsHref } from './admin-exercise-book';
import { LEARNER_LIST_HREF } from './exercise-book-runner';

/**
 * Admin entry links for one class. Each link appears only when its read route
 * answered 200 for this account (CR F16, contract §6); a 403/404/503 renders
 * nothing, so classes without the book and staff without a grant see no change.
 * Exception (contract v1.2 §6): the grant routes always need a step-up
 * ≤ 600 s, so a 403 `step_up_required` still means "owner" and keeps the grants
 * link; the page asks for MFA. Only `not_owner` (or any other refusal) hides it.
 * The probes are quiet: opening the Homework tab never triggers a login
 * redirect or an MFA step-up prompt.
 */
export function ExerciseBookAdminEntry({ cohortId, api }: { cohortId: string; api?: ExerciseBookApi }) {
  return <ExerciseBookApiProvider api={api}><AdminEntry key={cohortId} cohortId={cohortId} /></ExerciseBookApiProvider>;
}

function AdminEntry({ cohortId }: { cohortId: string }) {
  const api = useExerciseBookApi();
  const [links, setLinks] = useState<{ book: boolean; grants: boolean }>({ book: false, grants: false });
  useEffect(() => {
    let active = true;
    void Promise.allSettled([api.getCatalog(cohortId, { quiet: true }), api.getGrants(cohortId, { quiet: true })]).then(([book, grants]) => {
      const grantsOpen = grants.status === 'fulfilled' || errorCode(grants.reason) === 'step_up_required';
      if (active) setLinks({ book: book.status === 'fulfilled', grants: grantsOpen });
    });
    return () => { active = false; };
  }, [api, cohortId]);
  if (!links.book && !links.grants) return null;
  return (
    <div className="ach-section-actions" aria-label="Sách bài tập">
      {links.book && <a className="adm-btn-secondary" href={adminExerciseBookHref(cohortId)}>Sách bài tập Listening</a>}
      {links.grants && <a className="adm-btn-secondary" href={adminGrantsHref(cohortId)}>Quyền sách bài tập</a>}
    </div>
  );
}

/** Learner link from My Class, shown only when the learner has at least one book assignment. */
export function ExerciseBookLearnerEntry({ api }: { api?: ExerciseBookApi }) {
  return <ExerciseBookApiProvider api={api}><LearnerEntry /></ExerciseBookApiProvider>;
}

function LearnerEntry() {
  const api = useExerciseBookApi();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    api.listMyAssignments({ limit: 1 }).then((page) => { if (active) setCount(page.items.length); }, () => { if (active) setCount(0); });
    return () => { active = false; };
  }, [api]);
  if (!count) return null;
  return <p><a href={LEARNER_LIST_HREF}>Sách bài tập Listening được giao</a></p>;
}
