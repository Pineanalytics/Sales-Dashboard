import { CreditNotesView } from "@/components/creditNotes/CreditNotesView";

// The Credit Notes & Returns module. The route and its page key stay "sales-returns" so every existing
// access grant keeps working; only the module's name and content changed. The report is built per request
// by /api/credit-notes from the SAP document lines, for the period and principals chosen in the global
// filter bar, and cut to the viewer's own scope on the server.
export const dynamic = "force-dynamic";

export default function CreditNotesReturnsPage() {
  return <CreditNotesView />;
}
