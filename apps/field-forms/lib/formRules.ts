import type { FormField } from "./types";
import { PHOTO_EXEMPT_RETAILERS } from "./codeLookups";

// Some fields' required-ness depends on another field's answer. Centralized
// here so the live form and the admin edit view apply the same rule.
export function isFieldRequired(
  field: FormField,
  answers: Record<string, string | string[]>,
  allFields: FormField[]
): boolean {
  if (!field.required) return false;

  if (field.label === "Shelf Photo") {
    const retailerField = allFields.find((f) => f.label === "Retailer Name");
    const retailerValue = retailerField ? answers[retailerField.id] : undefined;
    if (
      typeof retailerValue === "string" &&
      PHOTO_EXEMPT_RETAILERS.includes(retailerValue)
    ) {
      return false;
    }
  }

  return true;
}
