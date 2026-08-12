export type FeedbackType = 'rating' | 'report' | 'flag';
export type FeedbackSkill = 'reading' | 'listening' | 'vocabulary';
export type FeedbackStatus = 'new' | 'resolved';

export type FeedbackItem = {
  id: string;
  type: FeedbackType;
  skill: FeedbackSkill;
  status: FeedbackStatus;
  testId: string | null;
  questionNumber: number | null;
  ratingTest: number | null;
  ratingAudio: number | null;
  category: string | null;
  note: string | null;
  identityKind: 'user' | 'anonymous' | 'unknown';
  createdAt: string | null;
};

export type FeedbackInbox = {
  status: 'complete' | 'partial' | 'unavailable';
  snapshotTo: string;
  skill: FeedbackSkill | null;
  type: FeedbackType | null;
  itemStatus: FeedbackStatus | null;
  items: FeedbackItem[];
  count: number | null;
  truncated: boolean;
  malformedCount: number;
};

export type FeedbackFilters = {
  type: FeedbackType | '';
  skill: FeedbackSkill | '';
  status: FeedbackStatus | '';
};
