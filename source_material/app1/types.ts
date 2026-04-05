

export interface SpokenQuestion {
    text: string;
}

export interface Part1TopicSet {
  topic: string;
  questions: SpokenQuestion[];
}

export interface Part2CueCard {
  topic: string;
  instruction: string;
  points: string[];
}

export interface Part3Topic {
  topic: string;
  questions: SpokenQuestion[];
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export interface TestPlan {
  part1: Part1TopicSet[];
  part2: Part2CueCard;
  part3: Part3Topic[];
}

export interface RecordedAnswer {
    part: string;
    topic: string;
    question: string;
    transcript: string;
    audioBlob: Blob;
}

export interface AnalysisResult {
  overallBandScore: number;
  fluency: {
    score: number;
    feedback: string;
  };
  lexicalResource: {
    score: number;
    feedback: string;
  };
  grammar: {
    score: number;
    feedback: string;
  };
  pronunciation: {
    score: number;
    feedback: string;
  };
  summary: string;
  goldenTip: string;
  fullTranscript: string;
}

export interface PartPracticeAnalysis {
  highlightedTranscript: { text: string; isMistake: boolean; }[];
  corrections: {
    incorrectPhrase: string;
    correction: string;
    explanation: string; // in Vietnamese
    category: 'Grammar' | 'Vocabulary' | 'Phrasing' | 'Pronunciation Hint';
  }[];
  feedback: {
    fluency: string; // Vietnamese feedback for Fluency and Coherence
    lexicalResource: string; // Vietnamese feedback for Lexical Resource
    grammar: string; // Vietnamese feedback for Grammatical Range and Accuracy
    pronunciation: string; // Vietnamese feedback for Pronunciation
  };
  sampleAnswer: string;
  overallBandScore: number;
}


export enum TestPart {
  Intro = "INTRO",
  Part1Intro = "PART_1_INTRO",
  Part1 = "PART_1",
  Part1TopicTransition = "PART_1_TOPIC_TRANSITION",
  Part2Intro = "PART_2_INTRO",
  Part2Prep = "PART_2_PREP",
  Part2Speaking = "PART_2_SPEAKING",
  Part3Intro = "PART_3_INTRO",
  Part3 = "PART_3",
  Part3TopicTransition = "PART_3_TOPIC_TRANSITION",
  Analyzing = "ANALYZING",
  Results = "RESULTS",
}

export enum PracticePart {
  Part1 = "PART_1",
  Part2 = "PART_2",
  Part3 = "PART_3",
}

export interface TestState {
  part: TestPart;
  testPlan: TestPlan;
  part1CurrentTopicIndex: number;
  part1CurrentQuestionIndex: number;
  part3CurrentTopicIndex: number;
  part3CurrentQuestionIndex: number;
}

export interface PracticeQuestion {
  id: number;
  questionText: string;
  cueCard: Part2CueCard | null; // For Part 2
  status: 'pending' | 'answered';
  audioBlob: Blob | null;
  transcript: string | null;
  analysis: PartPracticeAnalysis | null;
  revealed?: boolean;
}

export interface IdeaBuilderResult {
  topic: string;
  mindMap: {
    mainIdeas: {
      idea: string;
      subIdeas: string[];
    }[];
  };
  vocabulary: {
    word: string;
    definition: string;
    example: string;
  }[];
  part1Questions: string[];
  part2CueCard: {
    instruction: string;
    points: string[];
  };
  part3Questions: string[];
}