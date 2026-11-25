export type UsageUser = {
  userId: string;
  email: string | null;
  name: string | null;
  role: string | null;
  sessions: number | null;
  lastActive: string | null;
  aiCostUsd: number | null;
};

export type UsageUsersPayload = { rows: UsageUser[]; malformedCount: number };

export type CodeUsagePayload = UsageUsersPayload & {
  code: { id: string; value: string; codeType: string | null; cohortId: string | null; sessionLimit: number | null };
  aggregate: { assignedUserCount: number; totalSessions: number | null; totalAiCostUsd: number | null };
};
