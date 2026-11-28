// Incident inbox API (G09-T07) for the inbox page (G09-T16).
import { getBrowserJson, getBrowserJsonAt, postBrowserJsonAt } from '@/lib/browser-api';
import type { ApiGetJson, ApiPostJson } from '@/lib/openapi-contract';
import type { paths } from '@/types/api';

export type IncidentGroupsPage = ApiGetJson<'/admin/incidents/groups'>;
export type IncidentGroup = IncidentGroupsPage['items'][number];
export type IncidentSource = IncidentGroup['source'];
export type IncidentStatus = IncidentGroup['status'];
export type IncidentGroupDetail = ApiGetJson<'/admin/incidents/groups/{source}/{fingerprint}'>;

type IncidentBulkBody = paths['/admin/incidents/groups/bulk']['post']['requestBody']['content']['application/json'];
type IncidentBulkResponse = ApiPostJson<'/admin/incidents/groups/bulk'>;
type IncidentWireConflict = IncidentBulkResponse['conflicts'][number];

export type IncidentAction = IncidentBulkBody['action'];
export type IncidentRef = IncidentBulkBody['groups'][number];
export type IncidentConflict = IncidentWireConflict | (
  Pick<IncidentWireConflict, 'source' | 'fingerprint'> & { status: 409; code: 'refused' }
);
export type IncidentBulkResult = Omit<IncidentBulkResponse, 'conflicts'> & { conflicts: IncidentConflict[] };

export function fetchIncidentGroups(query: URLSearchParams): Promise<IncidentGroupsPage> {
  return getBrowserJson('/admin/incidents/groups', query);
}

export function fetchIncidentGroup(source: string, fingerprint: string): Promise<IncidentGroupDetail> {
  return getBrowserJsonAt(
    '/admin/incidents/groups/{source}/{fingerprint}',
    `/admin/incidents/groups/${encodeURIComponent(source)}/${encodeURIComponent(fingerprint)}`,
  );
}

/** Whole-batch errors keep the existing summary. Per-group outcomes come from the successful bulk payload. */
export async function postIncidentBulk(
  action: IncidentAction, groups: IncidentRef[], note?: string,
): Promise<IncidentBulkResult> {
  const body: IncidentBulkBody = { action, groups, ...(note ? { note } : {}) };
  try {
    return await postBrowserJsonAt('/admin/incidents/groups/bulk', '/admin/incidents/groups/bulk', body);
  } catch (caught) {
    const status = (caught as { status?: number })?.status;
    if (status !== 409 && status !== 503) throw caught;
    return {
      changed: 0,
      conflicts: groups.map(({ source, fingerprint }) => status === 409
        ? { source, fingerprint, status, code: 'refused' }
        : { source, fingerprint, status, code: 'write_failed' }),
      dismiss_failed: [],
    };
  }
}
