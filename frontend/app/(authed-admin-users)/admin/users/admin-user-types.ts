export type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  created_at: string | null;
  is_active: boolean;
  role: 'admin' | 'instructor' | 'student';
  sessions_today: number;
  cohort_name: string | null;
  code_summary: {
    codes: Array<{ id: string; code: string; code_type: string; permissions: string[]; is_active: boolean; created_at: string | null }>;
    code_count: number;
    code_type: string | null;
    permissions: string[];
    has_active_code: boolean;
  };
};

export type AdminCohort = { id: string; name: string };

export type AccessCodeQuota = {
  used: number;
  limit: number | null;
  remaining: number | null;
  limit_type: string;
};

export type AccessCodeUser = {
  user_id: string;
  name: string;
  email: string;
  is_fallback_used_by: boolean;
  removable: boolean;
  quota: AccessCodeQuota | null;
};

export type AccessCode = {
  id: string;
  code: string;
  is_used: boolean;
  is_revoked: boolean;
  is_active: boolean;
  used_by: string | null;
  used_at: string | null;
  created_at: string | null;
  permissions: string[];
  session_limit: number | null;
  expires_at: string | null;
  code_type: 'mass' | 'direct' | 'staff';
  cohort_id: string | null;
  cohort_name: string | null;
  notes: string | null;
  assigned_user_count: number;
  assigned_users: AccessCodeUser[];
  association_lookup_failed: boolean;
};

export type Banner = { kind: 'success' | 'error'; text: string } | null;
export type SortState = { field: string; order: 'asc' | 'desc' };

export const ROLES = ['admin', 'instructor', 'student'] as const;
export const CODE_TYPES = ['mass', 'direct', 'staff'] as const;
export const PERMISSIONS = [
  ['all', 'Tất cả'],
  ['writing', 'Writing'],
  ['practice_single', 'Luyện tập đơn'],
  ['practice_part', 'Luyện theo Part'],
  ['practice_full', 'Full Test'],
  ['admin', 'Admin'],
] as const;
