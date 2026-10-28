import 'client-only';

import { getBrowserJson, patchBrowserJsonAt } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';
import type { components } from '@/types/api';

export type AdminAiModelsWire = ApiGetJson<'/admin/ai/models'>;
export type AdminAiUsageWire = ApiGetJson<'/admin/ai/usage'>;
export type AdminAiFailuresWire = ApiGetJson<'/admin/ai/failures'>;
export type AdminAiOverrideBody = components['schemas']['AdminAiOverrideIn'];
export type AiWindowKey = 'today' | '7d' | '30d';

export function getAdminAiModels() {
  return getBrowserJson('/admin/ai/models');
}

export function getAdminAiUsage(window: AiWindowKey) {
  return getBrowserJson('/admin/ai/usage', new URLSearchParams({ window }));
}

export function getAdminAiFailures(window: AiWindowKey) {
  return getBrowserJson('/admin/ai/failures', new URLSearchParams({ window }));
}

/** Set or clear (null) one feature's preference; returns the refetched canonical state. */
export function patchAdminAiModel(feature: string, body: AdminAiOverrideBody) {
  return patchBrowserJsonAt(
    '/admin/ai/models/{feature}',
    `/admin/ai/models/${encodeURIComponent(feature)}`,
    body,
  );
}
