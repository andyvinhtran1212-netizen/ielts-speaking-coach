export type SessionAlert = {
  id: string;
  userId: string | null;
  userEmail: string | null;
  mode: string | null;
  part: string | null;
  topic: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  failedStep: string | null;
  occurredAt: string | null;
  status: string | null;
};

export type GradingAlert = {
  id: string;
  sessionId: string;
  questionId: string | null;
  userEmail: string | null;
  gradingStatus: string | null;
  sttStatus: string | null;
};

export type AlertsPayload = {
  sessionErrors: SessionAlert[];
  gradingFailures: GradingAlert[];
  malformedCount: number;
};

export type AlertScope = 'all' | 'sessions' | 'grading';
