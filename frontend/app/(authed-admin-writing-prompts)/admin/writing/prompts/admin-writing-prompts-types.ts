export type TaskType = 'task1_academic' | 'task1_general' | 'task2';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type AnalysisStatus = 'pending' | 'ready' | 'failed' | null;

export interface PromptAnalysis {
  chartType: 'line' | 'bar' | 'pie' | 'table' | 'map' | 'process' | 'mixed';
  overview: string;
  keyFeatures: string[];
  notableData: Array<{ label: string; value: string; unit: string | null }>;
  axesOrCategories: string | null;
  gradingNote: string | null;
}

export interface WritingPrompt {
  id: string;
  taskType: TaskType;
  title: string;
  promptText: string;
  difficulty: Difficulty | null;
  tags: string[];
  isActive: boolean;
  examOnly: boolean;
  imageUrl: string | null;
  imagePublicId: string | null;
  analysis: PromptAnalysis | null;
  analysisStatus: AnalysisStatus;
  analysisReviewed: boolean;
  analysisModel: string | null;
  analyzedImagePublicId: string | null;
  analysisError: string | null;
  analysisAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  malformedOptional: number;
}

export interface PromptDraft {
  title: string;
  taskType: TaskType;
  promptText: string;
  difficulty: Difficulty | '';
  tags: string;
  imageUrl: string;
  imagePublicId: string;
}

export interface AnalysisDraft {
  chartType: PromptAnalysis['chartType'];
  overview: string;
  keyFeatures: string;
  notableData: string;
  axesOrCategories: string;
  gradingNote: string;
}

export type PromptAction =
  | { kind: 'archive' | 'restore' | 'visibility' | 'reanalyze'; prompt: WritingPrompt };
