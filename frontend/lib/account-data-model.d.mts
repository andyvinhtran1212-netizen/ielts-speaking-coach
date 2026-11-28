export type DeletionView = { status: 'none' | 'pending' | 'erasing'; requestedAt: string | null; eraseAfter: string | null };
export type ExportStatus = 'none' | 'queued' | 'building' | 'ready' | 'expired' | 'failed' | 'cancelled' | 'purged';
export type ExportView = {
  status: ExportStatus;
  exportId: string | null;
  requestedAt: string | null;
  readyAt: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
};

export declare function normalizeDeletion(raw: unknown): DeletionView | null;
export declare function normalizeExport(raw: unknown): ExportView | null;
export declare function emailMatches(typed: string, loginEmail: string | null | undefined): boolean;
export declare function isStaffRole(role: unknown): boolean;
export declare function errorCode(error: unknown): string | null;
export declare function errorStatus(error: unknown): number | null;
export declare function retryAtText(error: unknown, now?: number): string | null;
export declare function sizeText(bytes: number | null): string | null;
export declare function eraseDateText(iso: string | null): string | null;
export declare function exportTimeText(iso: string | null): string | null;
export declare function downloadPath(exportId: string): string;
