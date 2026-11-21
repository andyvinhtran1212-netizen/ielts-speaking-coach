/**
 * Whole numbers as the design sheets print them: thousands split by a
 * no-break space ("1 284"), not the "1.284" of `vi-VN`, which reads as a
 * decimal next to band scores.
 */
export function formatCount(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
