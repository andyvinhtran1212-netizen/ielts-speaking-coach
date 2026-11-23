// PUBLICSITE-0059 §5.2/5.3 (G05-T02) — wire types of the G04 commerce API.
// Written from the serializer of COURSEACCESS-0055 G04-T03 (#2485,
// backend/routers/courses_public.py `catalog_item` / `get_course`). Once that
// PR is on staging and frontend/types/api.d.ts carries these routes, the
// bodies below become aliases of the generated types; the export names stay.

export type CourseStatus = 'open' | 'coming_soon' | 'closed';
export type ViewerState = 'guest' | 'can_enroll' | 'open_order' | 'enrolled' | 'expired';

export interface CourseViewer {
  state: ViewerState;
  days_left: number | null;
  can_renew: boolean;
  open_order_code: string | null;
}

export interface CourseAuthor {
  name: string | null;
  bio_line: string | null;
  photo_url: string | null;
}

export interface CourseItem {
  slug: string;
  title: string;
  short_title: string | null;
  summary: string | null;
  status: CourseStatus;
  tuition_vnd: number | null;
  access_days: number | null;
  ai_credits: number;
  credit_valid_days: number | null;
  credits_expire_note: string | null;
  credit_carry_percent: number | null;
  credit_carry_valid_days: number | null;
  level_from: string | null;
  level_to: string | null;
  lesson_count: number | null;
  author: CourseAuthor | null;
  features: string[];
  expected_open_on: string | null;
  viewer: CourseViewer;
}

export interface CourseLesson {
  title: string;
  kind: string;
  duration_min: number | null;
  is_preview: boolean;
  preview_href: string | null;
}

export interface CourseChapter {
  title: string;
  lessons: CourseLesson[];
}

export interface CourseDetail extends CourseItem {
  course_code: string | null;
  faq: { q: string | null; a: string | null }[] | null;
  chapters: CourseChapter[] | null;
}

/** `GET /api/me/courses` (G04 me_access.build_my_courses): only the fields G05 reads. */
export interface MyCourses {
  items: { product_slug: string | null; state: string; expires_at: string | null; days_left: number | null }[];
  /** Until when submitted work stays readable after expiry; null until G04-T10 wires it. */
  content_visible_until: string | null;
}

export interface CourseCatalog {
  items: CourseItem[];
}

export type OrderStatus = 'awaiting_transfer' | 'transfer_reported' | 'needs_info' | 'confirmed' | 'expired' | 'cancelled';

export interface OrderTransfer {
  bank_bin: string;
  bank_name: string;
  account_no: string;
  account_name: string;
  amount_vnd: number;
  memo: string;
  vietqr_payload: string | null;
  qr_image_url: string | null;
}

export interface Order {
  order_code: string;
  status: OrderStatus;
  product: { slug: string; title: string; short_title: string | null };
  tuition_vnd: number | null;
  access_days: number | null;
  ai_credits: number | null;
  credit_valid_days: number | null;
  pay_by: string | null;
  created_at: string;
  transfer_reported_at: string | null;
  late_transfer_reported_at: string | null;
  confirmed_at: string | null;
  reopened_at: string | null;
  info_kind: 'underpaid' | 'not_found' | 'other' | null;
  received_vnd: number | null;
  overpaid_vnd: number | null;
  admin_message: string | null;
  supplement_by: string | null;
  cancel_reason: 'learner' | 'admin' | null;
  cancel_note: string | null;
  cancelled_at: string | null;
  entitlement_expires_at: string | null;
  credits_granted: number | null;
  transfer: OrderTransfer | null;
}
