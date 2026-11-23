// Incident inbox API (G09-T07, `/admin/incidents/groups…`) for the inbox page
// (G09-T16). The shapes mirror backend/models/admin_incidents.py; they are
// local because the generated contract on this branch predates G09-T07.

export type IncidentSource = 'errors' | 'grading' | 'feedback';
export type IncidentStatus = 'new' | 'in_review' | 'resolved' | 'ignored';
export type IncidentAction = 'claim' | 'resolve' | 'ignore' | 'reopen';

export type IncidentGroup = {
  source: IncidentSource;
  fingerprint: string;
  title: string;
  area: string;
  level?: string | null;
  count: number;
  learners: number;
  first_at: string | null;
  last_at: string | null;
  status: IncidentStatus;
  claimed_by_name?: string | null;
  overdue: boolean;
};

export type IncidentGroupsPage = {
  items: IncidentGroup[];
  total: number;
  page: number;
  page_size: number;
  counts: Record<IncidentSource, number | null>;
  review_items_open: number | null;
  sources_failed: IncidentSource[];
  truncated: boolean;
  sources_truncated: IncidentSource[];
  generated_at: string;
};

export type IncidentNote = { body: string; auto: boolean; actor_name?: string | null; created_at?: string | null };

export type IncidentGroupDetail = IncidentGroup & {
  description: string;
  claimed_at?: string | null;
  resolved_at?: string | null;
  learner_list: { ref: string; name: string }[];
  technical: Record<string, unknown>;
  notes: IncidentNote[];
};

export type IncidentConflict = {
  source: IncidentSource;
  fingerprint: string;
  status: number;
  code: 'count_changed' | 'not_found' | 'write_failed';
};

export type IncidentBulkResult = { changed: number; conflicts: IncidentConflict[]; dismiss_failed: string[] };

export type IncidentRef = {
  source: IncidentSource;
  fingerprint: string;
  expected_count: number;
  expected_last_at?: string;
};

type ApiError = Error & { status?: number; code?: string | null };

export function fetchIncidentGroups(query: URLSearchParams): Promise<IncidentGroupsPage> {
  return window.api.getWith<IncidentGroupsPage>(`/admin/incidents/groups?${query}`);
}

export function fetchIncidentGroup(source: string, fingerprint: string): Promise<IncidentGroupDetail> {
  return window.api.getWith<IncidentGroupDetail>(
    `/admin/incidents/groups/${encodeURIComponent(source)}/${encodeURIComponent(fingerprint)}`);
}

/**
 * Bulk action. When every ref conflicts the API answers 409/503 and api.js
 * throws without the conflict list; that comes back here as a result with no
 * change and one conflict per ref, so the page can say "tải lại".
 */
export async function postIncidentBulk(
  action: IncidentAction, groups: IncidentRef[], note?: string,
): Promise<IncidentBulkResult> {
  try {
    return await window.api.post<IncidentBulkResult>('/admin/incidents/groups/bulk', {
      action, groups, ...(note ? { note } : {}),
    });
  } catch (caught) {
    const status = (caught as ApiError)?.status;
    if (status !== 409 && status !== 503) throw caught;
    const code = status === 409 ? 'count_changed' : 'write_failed';
    return {
      changed: 0,
      conflicts: groups.map((g) => ({ source: g.source, fingerprint: g.fingerprint, status, code })),
      dismiss_failed: [],
    };
  }
}
