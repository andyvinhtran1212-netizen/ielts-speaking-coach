import type { LedgerRowWire, UserAccessWire, UserCreditsWire } from './admin-credits-api';

export declare const HISTORY_PAGE_SIZE: number;
export declare const REASON_MIN: number;
export declare const REASON_MAX: number;
export declare const DELTA_MAX: number;
export declare const OTHER_LABEL: string;
export declare const LOW_CREDITS_HREF: string;
export declare const GRANT_EXTRA_HREF: string;

export type BalanceCard = {
  key: string;
  entitlementId: string | null;
  title: string;
  state: string;
  stateText: string;
  expires: string;
  balance: number | null;
  usableFrom: string;
  carry: { count: number; until: string } | null;
  carryText: string;
};

export type HistoryRow = {
  key: string;
  at: string;
  label: string;
  detail: string;
  delta: string;
  positive: boolean;
  course: string;
  actor: string;
  note: string;
  balanceAfter: string;
};

export type AdjustDraft = { entitlementId: string; direction: 'add' | 'subtract'; amount: string; reason: string };
export type AdjustCheck =
  | { ok: false; error: string }
  | { ok: true; course: BalanceCard; body: { entitlement_id: string; delta: number; reason: string }; confirmText: string };

export declare function userIdFromRef(ref: string | null | undefined): string | null;
export declare function dateVi(iso: string | null | undefined): string;
export declare function dateTimeVi(iso: string | null | undefined): string;
export declare function signed(n: number): string;
export declare function courseTitle(item: { short_title?: string | null; title?: string | null; course_code?: string | null } | null | undefined): string;
export declare function balanceCards(access: UserAccessWire | null | undefined): BalanceCard[];
export declare function adjustableCourses(access: UserAccessWire | null | undefined): BalanceCard[];
export declare function historyRows(
  history: Pick<UserCreditsWire, 'items'> | { items: LedgerRowWire[] } | null | undefined,
  access: UserAccessWire | null | undefined,
): HistoryRow[];
export declare function adjustDraft(courses: BalanceCard[]): AdjustDraft;
export declare function validateAdjust(draft: AdjustDraft, courses: BalanceCard[]): AdjustCheck;
