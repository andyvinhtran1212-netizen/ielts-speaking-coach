export type InstructorMetric = {
  instructorId: string;
  email: string | null;
  displayName: string | null;
  students: number;
  prompts: number;
  graded: number;
  regraded: number;
  regradeEvents: number;
  tokens: number;
  costUsd: number;
};

export type InstructorsPayload = {
  rows: InstructorMetric[];
  malformedCount: number;
};
