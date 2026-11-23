export type ReportTab = 'hoat-dong' | 'luu-luong' | 'chi-phi-ai' | 'chat-luong';
export type ReportRange = 7 | 30 | 90;
export type ReportCellKind = 'text' | 'count' | 'usd' | 'usd4' | 'pct';
export type ReportCell = string | number | null;
export type ReportTable = {
  id: string;
  title: string;
  caption: string;
  source: string;
  columns: { label: string; kind: ReportCellKind }[];
  rows: ReportCell[][];
};
export type ReportTile = {
  id: string;
  label: string;
  value: number | null;
  kind: ReportCellKind;
  note?: string | null;
  reason?: string | null;
  atLeast?: boolean;
};

export const REPORT_TABS: readonly { id: ReportTab; label: string }[];
export const REPORT_RANGES: readonly ReportRange[];
export function parseReportsQuery(query?: string): { tab: ReportTab; range: ReportRange };
export function reportsHref(state: { tab: string; range: number }): string;
export function tabLabel(tab: string): string;
export function liveAdminHref(href: string): string | null;
export function rangeDays(range: number, now?: Date): { from: string; to: string };
export function rangeText(range: number, now?: Date): string;
export function footTrafficQuery(range: number, now?: Date): URLSearchParams;
export function formatCell(value: ReportCell, kind?: ReportCellKind): string;
export function reportCsv(tables: Pick<ReportTable, 'title' | 'columns' | 'rows'>[]): string;
export function csvFileName(tab: string, range: number, now?: Date): string;
export function activityReport(raw: unknown, range: number): { tiles: ReportTile[]; tables: ReportTable[]; cohortsReason: string } | null;
export function trafficReport(raw: unknown, range: number, now?: Date):
  { status: 'complete' | 'partial' | 'unavailable'; partial: boolean; tiles: ReportTile[]; tables: ReportTable[] } | null;
export function aiCostReport(raw: unknown): { truncated: boolean; tiles: ReportTile[]; tables: ReportTable[] } | null;
