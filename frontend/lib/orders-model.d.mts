export type OrderStatus = 'awaiting_transfer' | 'transfer_reported' | 'needs_info' | 'confirmed' | 'expired' | 'cancelled';
export type OrderRow = {
  code: string;
  status: OrderStatus;
  title: string;
  shortTitle: string | null;
  tuition: number | null;
  createdAt: string | null;
};
export type OrderPage = { items: OrderRow[]; nextCursor: string | null };

export declare const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>>;
export declare function normalizeOrderPage(raw: unknown): OrderPage | null;
export declare function orderStatusLabel(status: unknown): string | null;
export declare function orderNextStep(
  order: OrderRow,
  resolve: (href: string) => string | null,
): { label: string; href: string | null } | null;
export declare function formatVnd(amount: unknown): string | null;
export declare function orderDateText(iso: string | null): string | null;
