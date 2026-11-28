'use client';

// LEARNERCORE-0063 FR-104: whether the review workspace is drawn inside the
// new tree. Its own module, so the old tree never loads the frame (or its CSS)
// just to ask.
import { createContext, useContext } from 'react';

export type ReviewV2 = { enabled: boolean };

export const REVIEW_V2_OFF: ReviewV2 = Object.freeze({ enabled: false });
export const REVIEW_V2_ON: ReviewV2 = Object.freeze({ enabled: true });
export const ReviewV2Context = createContext<ReviewV2>(REVIEW_V2_OFF);

export function useReviewV2(): ReviewV2 {
  return useContext(ReviewV2Context);
}
