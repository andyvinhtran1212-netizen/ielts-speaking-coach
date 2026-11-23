// Replacing the URL from a v2 page (UIBASE-0056 FR-015): a soft `router.replace`
// keeps the current document, so it is used only when the target is in the v2
// tree too. A target in the legacy tree gets a full document replacement, so no
// v2 stylesheet stays behind. `ChromeNavigationBridge` does this for link
// clicks; it cannot see `router.replace`, hence this helper.
import { isV2Path } from '@/lib/v2-routes.mjs';

/** The document-level replacement; an object so tests can observe it. */
export const documentNavigation = {
  replace(href: string): void {
    window.location.replace(href);
  },
};

export function replaceAcrossTrees(router: { replace(href: string): void }, href: string): void {
  if (isV2Path(href)) router.replace(href);
  else documentNavigation.replace(href);
}
