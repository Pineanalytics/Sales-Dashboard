export const ORG_UNIT_TYPES = ["region", "territory", "distributor"] as const;
export type OrgUnitType = (typeof ORG_UNIT_TYPES)[number];

export const QUESTION_TYPES = ["rating_1_5", "yes_no_na", "text", "photo"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const ACCOMPANIMENT_STATUSES = [
  "draft",
  "submitted",
  "sales_rep_acknowledged",
  "supervisor_reviewed",
  "approved",
] as const;
export type AccompanimentStatus = (typeof ACCOMPANIMENT_STATUSES)[number];

export const GEOFENCE_STATUSES = ["inside", "outside", "gps_unavailable"] as const;
export type GeofenceStatus = (typeof GEOFENCE_STATUSES)[number];

export const ACTION_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const ACTION_STATUSES = [
  "open",
  "in_progress",
  "completed",
  "overdue",
  "verified",
  "closed",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

// key_account_rep: a real login user (unlike sales_rep) who is not coached
// by a Team Leader — they self-log their own outlet visits/actions. Their
// self-visits reuse the coaching_accompaniments schema wholesale: an
// auto-provisioned coaching_sales_reps row is created with id = their own
// profiles.id, so team_leader_id and sales_rep_id on their own records both
// point back to themselves and every existing "own record" RLS policy
// (keyed on team_leader_id/sales_rep_id = auth.uid()) just works unchanged.
export const FIELD_ROLES = ["team_leader", "sales_rep", "supervisor", "key_account_rep"] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];

// Sales Reps are a lightweight roster their Team Leader manages and selects
// from — they do NOT get their own login/auth account (only Team Leaders,
// Supervisors, and Admins do). email is optional and unused for
// authentication; it's just a reference field in case one is known.
export interface CoachingSalesRep {
  id: string;
  form_id: string;
  full_name: string;
  email: string | null;
  employee_code: string | null;
  team_leader_id: string;
  is_active: boolean;
}

export interface CoachingOrgUnit {
  id: string;
  form_id: string;
  unit_type: OrgUnitType;
  name: string;
  parent_id: string | null;
  is_active: boolean;
}

export interface CoachingChannel {
  id: string;
  form_id: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
}

export interface CoachingRoute {
  id: string;
  form_id: string;
  name: string;
  territory_id: string | null;
  is_active: boolean;
}

// Supplier the company represents — customers (outlets) are aligned to one,
// and a Team Leader can be dedicated to more than one (team_leader_principals).
export interface CoachingPrincipal {
  id: string;
  form_id: string;
  name: string;
  is_active: boolean;
}

export interface CoachingOutlet {
  id: string;
  form_id: string;
  outlet_code: string;
  name: string;
  trading_name: string | null;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  channel_id: string | null;
  route_id: string | null;
  territory_id: string | null;
  distributor_id: string | null;
  principal_id: string | null;
  assigned_sales_rep_id: string | null;
  assigned_team_leader_id: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
  is_active: boolean;
}

export interface CoachingJourneyPlan {
  id: string;
  form_id: string;
  sales_rep_id: string;
  route_id: string | null;
  plan_date: string;
  outlet_id: string;
  planned_sequence: number;
  is_active: boolean;
}

export interface CoachingTemplate {
  id: string;
  form_id: string;
  name: string;
  version: number;
  is_active: boolean;
}

export interface CoachingTemplateSection {
  id: string;
  template_id: string;
  title: string;
  weight: number;
  order_index: number;
}

export interface CoachingTemplateQuestion {
  id: string;
  section_id: string;
  prompt: string;
  question_type: QuestionType;
  weight: number;
  is_mandatory: boolean;
  is_critical: boolean;
  conditional_parent_question_id: string | null;
  conditional_trigger_value: string | null;
  order_index: number;
}

export interface CoachingAccompaniment {
  id: string;
  form_id: string;
  template_id: string;
  team_leader_id: string;
  sales_rep_id: string;
  route_id: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  status: AccompanimentStatus;
  overall_score: number | null;
  supervisor_comments: string | null;
}

export interface CoachingOutletVisit {
  id: string;
  accompaniment_id: string;
  outlet_id: string;
  planned: boolean;
  arrival_at: string | null;
  departure_at: string | null;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy_m: number | null;
  distance_from_outlet_m: number | null;
  geofence_status: GeofenceStatus | null;
  notes: string | null;
}

export interface CoachingVisitAnswer {
  id: string;
  outlet_visit_id: string;
  question_id: string;
  answer_value: string | null;
  comment: string | null;
  photo_url: string | null;
}

export interface CoachingActionPlan {
  id: string;
  accompaniment_id: string;
  issue: string;
  coaching_area: string | null;
  required_action: string;
  owner_id: string;
  target_date: string | null;
  priority: (typeof ACTION_PRIORITIES)[number];
  status: ActionStatus;
  evidence_required: boolean;
  evidence_url: string | null;
  completed_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  supervisor_comments: string | null;
}

// A photo captured during an outlet visit — GPS + timestamp are taken at
// the moment of capture (not upload) and are what "verifies" a visit
// actually happened at that outlet, rather than trusting the arrival fix
// alone. See coaching_outlets.latitude/longitude, which gets corrected to
// match this real field-captured position going forward.
export interface CoachingPhoto {
  id: string;
  accompaniment_id: string | null;
  outlet_visit_id: string | null;
  question_id: string | null;
  storage_url: string;
  caption: string | null;
  taken_at: string;
  uploaded_by: string | null;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy_m: number | null;
}

export interface CoachingSelfEvaluation {
  id: string;
  accompaniment_id: string;
  sales_rep_id: string;
  went_well: string | null;
  biggest_challenge: string | null;
  missed_opportunity: string | null;
  would_do_differently: string | null;
  support_needed: string | null;
  main_learning: string | null;
}

// Performance bands (§10 of the spec) — kept as a plain constant for Phase 1
// rather than a per-tenant admin-configurable table, matching how the asset
// system started with fixed constants before growing configurability.
export const PERFORMANCE_BANDS = [
  { min: 90, label: "Excellent", color: "#0E7C3A" },
  { min: 80, label: "Very Good", color: "#25D8FF" },
  { min: 70, label: "Good", color: "#153D9A" },
  { min: 60, label: "Needs Improvement", color: "#F7931E" },
  { min: 0, label: "Critical Improvement Required", color: "#C00000" },
] as const;

export function performanceBandFor(percentScore: number) {
  return PERFORMANCE_BANDS.find((b) => percentScore >= b.min) ?? PERFORMANCE_BANDS[PERFORMANCE_BANDS.length - 1];
}
