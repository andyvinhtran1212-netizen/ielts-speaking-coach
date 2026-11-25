export type SpeakingTopic = {
  id: string;
  title: string;
  part: 1 | 2 | 3;
  category: string;
  isActive: boolean;
  questionCount: number | null;
  questionMetadataLookupFailed: boolean;
  status: string;
  statusLabel: string;
  lastUpdatedAt: string | null;
  lastRotatedAt: string | null;
};

export type SpeakingQuestion = {
  id: string;
  topicId: string;
  part: 1 | 2 | 3;
  orderNum: number;
  text: string;
  questionType: string;
  cueCardBullets: string[];
  cueCardReflection: string;
  audioReady: boolean;
};

export type QuestionSnapshot = {
  account: string;
  topicId: string;
  rows: SpeakingQuestion[];
  malformed: number;
};

export type TopicDraft = { title: string; part: 1 | 2 | 3; category: string };
export type QuestionDraft = { text: string; part: 1 | 2 | 3; questionType: string; orderNum: string; bullets: string; reflection: string };

export type TopicAction =
  | { kind: 'toggle'; topic: SpeakingTopic }
  | { kind: 'generate'; topic: SpeakingTopic; mode: 'missing_only' | 'replace_all' }
  | { kind: 'delete'; topic: SpeakingTopic }
  | { kind: 'bulk-generate'; topics: SpeakingTopic[]; mode: 'missing_only' | 'replace_all' }
  | { kind: 'bulk-delete'; topics: SpeakingTopic[] }
  | { kind: 'delete-question'; topic: SpeakingTopic; question: SpeakingQuestion };
