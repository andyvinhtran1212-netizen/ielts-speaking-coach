export type ServiceUsage = { calls: number; cost: number };
export type UserUsage = { userId: string; email: string | null; displayName: string | null; calls: number; cost: number; services: Record<string, ServiceUsage> };
export type AiUsagePayload = {
  overall: { calls: number; cost: number; services: Record<string, ServiceUsage> };
  users: UserUsage[];
  meta: { queryLimit: number; returnedRows: number; totalMatchingRows: number | null; truncated: boolean };
  malformedCount: number;
};
