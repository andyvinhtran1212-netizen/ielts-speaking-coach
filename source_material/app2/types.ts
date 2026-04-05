export interface FeedbackItem {
  original: string;
  correction: string;
  explanation_vi: string;
}

export interface RelevanceFeedback {
  explanation_vi: string;
}

export interface ClarityConcisenessFeedback {
  clarity_vi: string;

  conciseness_vi: string;
}

export interface AnswerExpansion {
  suggestions_vi: string;
  sample_extended_answer: string;
}

export interface KeyMetrics {
  grammarSuggestionsCount: number;
  relevanceRating?: string;
  clarityRating?: string;
  overallScore?: number;
}

export interface AnalysisResult {
  keyMetrics: KeyMetrics;
  feedback: FeedbackItem[];
  improvedScript: string;
  relevanceFeedback?: RelevanceFeedback;
  clarityConcisenessFeedback?: ClarityConcisenessFeedback;
  answerExpansion?: AnswerExpansion;
}

export interface MispronouncedWord {
  mispronouncedWord: string;
  correctPronunciation: string;
  feedback_vi: string;
}

export interface OverallPronunciationFeedback {
  fluencyFeedback_vi: string;
  intonationFeedback_vi: string;
  stressFeedback_vi: string;
  rhythmFeedback_vi: string;
}

export interface PronunciationFeedbackResult {
  mispronouncedWords: MispronouncedWord[];
  overallFeedback?: OverallPronunciationFeedback;
}


export interface IeltsCriteriaFeedback {
  fluency_vi: string;
  lexicalResource_vi: string;
  grammaticalRangeAndAccuracy_vi: string;
  pronunciation_vi: string;
}

export interface TestEvaluationResult {
  overallScore: number;
  ieltsCriteriaFeedback: IeltsCriteriaFeedback;
  summary_vi: string;
  suggestions_vi: string;
  transcribedScript: string;
  improvedScript?: string;
}


export interface Student {
  id: string;
  code: string; // The login code, e.g., 'annpham2k@gmail.com'
}

export interface TrackedActivity {
  id: string;
  studentCode: string;
  activityType: 'Script Analysis';
  timestamp: string; // ISO string
  originalScript?: string;
  analysisResult?: AnalysisResult;
}