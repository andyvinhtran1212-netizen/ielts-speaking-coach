import 'client-only';

import { getBrowserJson } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';

export type AdminTestDataVisibilityWire = ApiGetJson<'/admin/test-data/visibility'>;

/** Read by public/js/api.js, which then sends `X-Show-Test-Data: 1`. */
export const SHOW_TEST_DATA_STORAGE_KEY = 'aver.showTestData';

export function getAdminTestDataVisibility() {
  return getBrowserJson('/admin/test-data/visibility');
}

/** Only a well-formed payload with hiding on renders the toggle. */
export function normalizeTestDataVisibility(payload: unknown): AdminTestDataVisibilityWire | null {
  if (!payload || typeof payload !== 'object') return null;
  const { hiding_enabled: hidingEnabled, showing_test_data: showing } = payload as Record<string, unknown>;
  if (hidingEnabled !== true || typeof showing !== 'boolean') return null;
  return { hiding_enabled: true, showing_test_data: showing };
}
