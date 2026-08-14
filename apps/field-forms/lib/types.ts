export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "email"
  | "date"
  | "select"
  | "multiselect"
  | "radio"
  | "checkbox"
  | "phone"
  | "photo"
  | "shelf_calculator";

export interface FormField {
  id: string;
  section_id: string;
  label: string;
  field_type: FieldType;
  options: string[] | null;
  required: boolean;
  placeholder: string | null;
  order_index: number;
}

export interface FormSection {
  id: string;
  form_id: string;
  title: string;
  description: string | null;
  order_index: number;
  form_fields: FormField[];
}

export interface FormRecord {
  id: string;
  title: string;
  description: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  brand_name: string | null;
  brand_logo_url: string | null;
  form_sections: FormSection[];
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: "user" | "admin" | "super_admin";
  status: "pending" | "approved" | "rejected";
  assigned_form_id: string | null;
  // Only meaningful for users assigned to a coaching-system_type form —
  // "team_leader" | "sales_rep" | "supervisor" | "key_account_rep". Sales
  // Reps never actually hold a login profile (see lib/coachingTypes.ts), so
  // this only shows up as an assignable option here for the other three.
  field_role: string | null;
  manager_id: string | null;
  territory: string | null;
  created_at: string;
}
