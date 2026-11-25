export type TrafficDay = { date: string; views: number };
export type TrafficPage = { path: string; views: number };

export type FootTrafficPayload = {
  status: 'complete' | 'partial' | 'unavailable';
  truncated: boolean;
  dateFrom: string | null;
  dateTo: string | null;
  route: string | null;
  snapshotTo: string | null;
  effectiveTo: string | null;
  totalViews: number | null;
  uniqueVisitors: number | null;
  anonymousHits: number | null;
  topPages: TrafficPage[];
  daily: TrafficDay[];
  malformedCount: number;
};
