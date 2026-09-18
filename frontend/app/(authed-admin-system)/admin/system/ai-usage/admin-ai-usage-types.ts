export type ServiceUsage = { calls: number; cost: number; pricedCalls: number | null; unpricedCalls: number | null };
export type UserUsage = { userId: string; email: string | null; displayName: string | null; calls: number; cost: number; services: Record<string, ServiceUsage> };
export type AiUsagePayload = {
  overall: { calls: number; cost: number; pricedCalls: number | null; unpricedCalls: number | null; failedCalls: number | null; legacyRepricedCalls: number | null; services: Record<string, ServiceUsage> };
  users: UserUsage[];
  meta: { queryLimit: number; returnedRows: number; totalMatchingRows: number | null; truncated: boolean; supplementalWritingRows: number | null; writingLookupFailed: boolean; ledgerReturnedRows: number | null; ledgerTotalMatchingRows: number | null; ledgerTruncated: boolean; ledgerSchemaLegacy: boolean; writingSourceReturnedRows: number | null; writingSourceTotalRows: number | null; writingSourceTruncated: boolean };
  malformedCount: number;
};
