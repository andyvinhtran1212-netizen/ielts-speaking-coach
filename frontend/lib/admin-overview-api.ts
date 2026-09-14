import 'client-only';

import { getBrowserJson } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';

export type AdminDashboardOverviewWire = ApiGetJson<'/admin/dashboard/overview'>;
export type AdminDashboardTrendsWire = ApiGetJson<'/admin/dashboard/trends'>;
export type AdminContentOverviewWire = ApiGetJson<'/admin/overview'>;

export function getAdminDashboardOverview(days: 7 | 30 | 90) {
  const query = new URLSearchParams({ visitors_window: String(days) });
  return getBrowserJson('/admin/dashboard/overview', query);
}

export function getAdminDashboardTrends(days: 7 | 30 | 90) {
  const query = new URLSearchParams({ days: String(days) });
  return getBrowserJson('/admin/dashboard/trends', query);
}

export function getAdminContentOverview() {
  return getBrowserJson('/admin/overview');
}
