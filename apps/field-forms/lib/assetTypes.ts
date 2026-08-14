export const ASSET_STATUSES = [
  "Draft",
  "Submitted",
  "Pending Manager Review",
  "Pending Admin Verification",
  "Returned for Correction",
  "Verified",
  "Rejected",
  "Active",
  "Transferred",
  "Returned",
  "Under Repair",
  "Lost",
  "Stolen",
  "Retired",
  "Disposed",
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_CONDITIONS = [
  "New",
  "Excellent",
  "Good",
  "Fair",
  "Damaged",
  "Faulty",
  "Under Repair",
  "Beyond Economic Repair",
] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

export const OWNERSHIP_TYPES = [
  "Company-owned",
  "Leased",
  "Rented",
  "Loaned",
  "Third-party",
] as const;

export const USAGE_TYPES = [
  "Individual",
  "Shared",
  "Pool",
  "Departmental",
  "Vehicle-based",
  "Site-based",
] as const;

export const LAPTOP_ACCESSORIES = [
  "Charger",
  "Laptop bag",
  "Mouse",
  "Docking station",
  "Monitor",
  "Keyboard",
  "Headset",
  "Security lock",
] as const;

export const PHOTO_KINDS = [
  "full",
  "serial_label",
  "damage",
  "document",
  "screenshot",
] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export const REASON_REQUIRED_EVENTS = new Set([
  "rejected",
  "returned_for_correction",
  "manual_correction",
  "retired",
  "disposed",
]);

export interface AssetCategory {
  id: string;
  form_id: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
  order_index: number;
  requires_manager_review: boolean;
}

export interface AssetFieldRule {
  id: string;
  category_id: string;
  field_key: string;
  is_required: boolean;
}

export interface Asset {
  id: string;
  form_id: string;
  asset_number: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  description: string | null;
  manufacturer: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  barcode: string | null;
  qr_value: string | null;
  imei: string | null;
  vehicle_reg: string | null;
  engine_number: string | null;
  chassis_vin: string | null;
  sim_number: string | null;
  po_number: string | null;
  supplier: string | null;
  purchase_date: string | null;
  purchase_cost: number | null;
  warranty_start: string | null;
  warranty_end: string | null;
  ownership_type: string | null;
  usage_type: string | null;
  status: AssetStatus;
  condition: AssetCondition | null;
  condition_notes: string | null;
  damage_description: string | null;
  accessories_received: string[] | null;
  missing_accessories: string[] | null;
  operational_test_result: string | null;
  current_employee_id: string | null;
  current_department: string | null;
  current_cost_centre: string | null;
  current_location: string | null;
  custodian: string | null;
  allocated_by: string | null;
  allocation_date: string | null;
  expected_return_date: string | null;
  allocation_purpose: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetPhoto {
  id: string;
  asset_id: string;
  kind: PhotoKind;
  storage_url: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface AssetSignature {
  id: string;
  asset_id: string;
  event_type: string;
  signer_id: string | null;
  typed_name: string;
  employee_number: string | null;
  signature_image_url: string;
  consent_at: string;
  device_ref: string | null;
}

export interface AssetEvent {
  id: string;
  asset_id: string;
  event_type: string;
  actor_id: string | null;
  from_value: unknown;
  to_value: unknown;
  comment: string | null;
  created_at: string;
}

export interface AssetDuplicateFlag {
  id: string;
  asset_id: string;
  matched_asset_id: string;
  matched_on: string;
  resolved: boolean;
  created_at: string;
}

export interface AppNotification {
  id: string;
  recipient_id: string;
  kind: string;
  asset_id: string | null;
  message: string;
  read_at: string | null;
  created_at: string;
}

// Duplicate-checkable identification fields, in the order the spec lists them.
export const DUPLICATE_CHECK_FIELDS = [
  "asset_number",
  "serial_number",
  "imei",
  "vehicle_reg",
  "barcode",
  "qr_value",
] as const;
