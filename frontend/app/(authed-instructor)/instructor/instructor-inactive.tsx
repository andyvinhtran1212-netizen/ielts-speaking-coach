'use client';

import { useCallback, useRef, useState, type RefObject } from 'react';

import {
  collectUnsavedDrafts,
  INSTRUCTOR_INACTIVE_TITLE,
  isInstructorInactiveError,
} from './instructor-inactive-model.mjs';

export type UnsavedDraft = { label: string; value: string };

/**
 * FR-014: the instructor clients pass every API error to `deny`. The first
 * inactive 403 marks the page inactive for good (until the signed-in account
 * changes); later answers must not bring instructor data back. With `rootRef`, the unsaved free text on the
 * page is copied before the denied state replaces it.
 */
export function useInstructorInactiveGuard(rootRef?: RefObject<HTMLElement | null>) {
  const [inactive, setInactive] = useState(false);
  const [drafts, setDrafts] = useState<UnsavedDraft[]>([]);
  const inactiveRef = useRef(false);

  const trip = useCallback(() => {
    if (inactiveRef.current) return;
    inactiveRef.current = true;
    // Read synchronously: the instructor content is still in the DOM here.
    if (rootRef) setDrafts(collectUnsavedDrafts(rootRef.current));
    setInactive(true);
  }, [rootRef]);

  // Call from a catch: true (and the page turns inactive) for the inactive 403.
  const deny = useCallback((caught: unknown) => {
    if (!isInstructorInactiveError(caught)) return false;
    trip();
    return true;
  }, [trip]);

  const reset = useCallback(() => {
    inactiveRef.current = false;
    setInactive(false);
    setDrafts([]);
  }, []);

  return { inactive, inactiveRef, drafts, deny, reset };
}

export function InstructorInactiveState({ className, drafts = [] }: { className: string; drafts?: UnsavedDraft[] }) {
  return (
    <div className={className} role="alert" data-testid="instructor-inactive">
      <h1>{INSTRUCTOR_INACTIVE_TITLE}</h1>
      <p>Trang giảng viên đã đóng vì tài khoản của bạn hiện không hoạt động. Hãy liên hệ admin để được mở lại.</p>
      {drafts.length ? (
        <section aria-label="Nội dung có thể chưa lưu" style={{ display: 'grid', gap: 8, width: 'min(640px, 100%)', textAlign: 'left' }}>
          <p>Nội dung bạn vừa nhập có thể chưa được lưu. Hãy sao chép để giữ lại:</p>
          {drafts.map((draft, index) => (
            <label key={`${draft.label}-${index}`} style={{ display: 'grid', gap: 4 }}>
              <span>{draft.label}</span>
              <textarea readOnly value={draft.value} rows={Math.min(10, Math.max(3, draft.value.split('\n').length))} style={{ width: '100%' }} />
            </label>
          ))}
        </section>
      ) : null}
      <a href="/home">Về trang học</a>
    </div>
  );
}
