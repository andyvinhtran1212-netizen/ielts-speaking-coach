/**
 * frontend/components/ui/breakpoints.ts — breakpoint constants of the new UI
 * tree (UIBASE-0056, G03-T02). CSS variables cannot be used inside @media, so
 * the numbers live here and in the header comment of styles/av2/tokens.css;
 * keep both in sync.
 */
export const AV2_BREAKPOINTS = Object.freeze({
  /** From here: tablet layout (learner "Menu: <mục>" button, no bottom bar). */
  tablet: 768,
  /** From here: desktop layout (learner top nav in one row). */
  desktop: 1024,
  /** From here: staff sidebar shows labels; below it collapses to icons. */
  wide: 1200,
} as const);

export type Av2Breakpoint = keyof typeof AV2_BREAKPOINTS;

/** `min-width` media query for a breakpoint, e.g. for `matchMedia`. */
export function av2MinWidth(name: Av2Breakpoint): string {
  return `(min-width: ${AV2_BREAKPOINTS[name]}px)`;
}
