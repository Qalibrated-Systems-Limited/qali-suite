/**
 * An employee's own payslip.
 *
 * Kept as its own path because the portal links to it, but it is now the same
 * code as the HR one — `getPayslipForPage` already refuses a payslip that is
 * not the caller's unless they hold an HR or finance role, so there is no
 * second ownership rule to keep in step.
 */
export { GET } from "../../payroll/[id]/payslip/[entryId]/route";
