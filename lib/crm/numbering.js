import "server-only";
import ErpCounter from "@/app/models/erp-counter";

// Human-friendly, tenant-scoped CRM identifiers (LEAD-0001, OPP-0001),
// minted off the same atomic ErpCounter the rest of the ERP uses. Plain
// async helpers (NOT server actions) so they can be shared between the
// lead and opportunity action modules and run inside a transaction by
// passing the session through.

export async function generateLeadNumber(companyId, session = null) {
  const seq = await ErpCounter.getNextSequence("lead", companyId, session);
  return `LEAD-${String(seq).padStart(4, "0")}`;
}

export async function generateOpportunityNumber(companyId, session = null) {
  const seq = await ErpCounter.getNextSequence("opportunity", companyId, session);
  return `OPP-${String(seq).padStart(4, "0")}`;
}
