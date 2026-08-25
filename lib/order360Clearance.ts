export interface Order360ClearanceAssignment {
  erpPrefix: string;
  principal: string;
  accountant: string;
}

/**
 * Clearance allocation supplied in Handwritten_List_Transcribed.xlsx.
 * Pine's SAP DocNum is the ERP number; its first three digits identify the
 * principal and the accountant responsible for clearing that order.
 */
export const ORDER360_CLEARANCE_ASSIGNMENTS: readonly Order360ClearanceAssignment[] = [
  { erpPrefix: "822", principal: "Upfield Nairobi", accountant: "Catherine Njeri" },
  { erpPrefix: "700", principal: "Ukl-Intl-Nairobi", accountant: "Catherine Njeri" },
  { erpPrefix: "500", principal: "EFL-Nairobi", accountant: "Catherine Njeri" },
  { erpPrefix: "600", principal: "Mars-Nairobi", accountant: "Kelly Paula" },
  { erpPrefix: "101", principal: "Tropikal-Nairobi", accountant: "Kelly Paula" },
  { erpPrefix: "310", principal: "Suntory-Nairobi", accountant: "Erick Yamina" },
  { erpPrefix: "300", principal: "Energia-Nairobi", accountant: "Erick Yamina" },
  { erpPrefix: "180", principal: "Weetabix-Nairobi", accountant: "Erick Yamina" },
] as const;

const assignmentsByPrefix = new Map(ORDER360_CLEARANCE_ASSIGNMENTS.map((assignment) => [assignment.erpPrefix, assignment]));

export function order360ErpPrefix(erpNumber: string): string | null {
  const digits = erpNumber.replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(0, 3) : null;
}

export function order360ClearanceAssignment(erpNumber: string): Order360ClearanceAssignment | null {
  const prefix = order360ErpPrefix(erpNumber);
  return prefix ? assignmentsByPrefix.get(prefix) ?? null : null;
}
