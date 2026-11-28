// Settings API (G09-T22, on staging) for the Settings page and the frame's
// ThresholdsProvider (G09-T23). Typed through the shared transport.
import { getBrowserJson, patchBrowserJsonAt } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';

export type ThresholdListWire = ApiGetJson<'/admin/settings/thresholds'>;
export type ThresholdItemWire = ThresholdListWire['items'][number];
export type SettingsLogWire = ApiGetJson<'/admin/settings/log'>;
export type SettingsLogItemWire = SettingsLogWire['items'][number];
export type ThresholdPatchWire = { changes: Array<{ key: string; value: number | null }>; reason: string };

export async function getThresholds(signal?: AbortSignal) {
  const result = await getBrowserJson('/admin/settings/thresholds', undefined, signal);
  if (!Array.isArray(result?.items)) throw new Error('Máy chủ chưa trả về bảng ngưỡng.');
  return result;
}

export async function saveThresholds(body: ThresholdPatchWire) {
  const result = await patchBrowserJsonAt('/admin/settings/thresholds', '/admin/settings/thresholds', body);
  const rows = result?.items;
  if (!Array.isArray(rows) || !body.changes.every(change =>
    rows.some(row => row.key === change.key && row.value === change.value))) {
    throw new Error('Máy chủ chưa xác nhận các giá trị đã gửi.');
  }
  return result;
}

/** Newest first; `cursor` pages back. Every section, so the table is the same at the end of each tab. */
export function getSettingsLog(cursor?: number | null) {
  const query = new URLSearchParams();
  if (cursor) query.set('cursor', String(cursor));
  return getBrowserJson('/admin/settings/log', query);
}
