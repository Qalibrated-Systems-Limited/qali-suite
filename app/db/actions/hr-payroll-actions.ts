"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { withAuthorizedTenant } from "../tenant";
import { roleAllowed } from "@/lib/permissions";
import { HR_VIEW_ROLES } from "@/lib/utils/role-gates";
import { userMessage } from "../errors";
import * as payroll from "../repositories/payroll";
import * as employees from "../repositories/employees";
import * as accounts from "../repositories/accounts";

/**
 * Postgres-backed payroll actions.
 *
 * HR prepares; finance approves and posts. That split is the source's and it
 * is right — approving a payroll writes to the ledger.
 */

const PREPARE_ROLES = [
  "SuperAdmin", "Admin", "CFO", "Finance Manager", "HR Manager",
];
const APPROVE_ROLES = ["SuperAdmin", "Admin", "CFO", "Finance Manager"];
const VOID_ROLES = ["SuperAdmin", "Admin", "CFO"];
const CONFIG_ROLES = ["SuperAdmin", "Admin", "CFO", "Finance Manager"];

export type ActionResult =
  | { success: true; id?: string; message?: string; [key: string]: unknown }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const num = (fd: FormData, key: string, fallback = 0) => {
  const n = Number(str(fd, key));
  return Number.isFinite(n) ? n : fallback;
};

export async function createPayrollRun(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const month = num(formData, "month");
  const year = num(formData, "year");

  const fieldErrors: Record<string, string> = {};
  if (!(month >= 1 && month <= 12)) fieldErrors.month = "Choose a month";
  if (!(year >= 2000)) fieldErrors.year = "Choose a year";
  if (Object.keys(fieldErrors).length) {
    return { success: false, error: "Choose the period to run", fieldErrors };
  }

  let id: string;
  try {
    const run = await withAuthorizedTenant(PREPARE_ROLES, (tx, { user, companyId }) =>
      payroll.createRun(tx, {
        companyId,
        month,
        year,
        departmentId: str(formData, "departmentId") || null,
        notes: str(formData, "notes") || null,
        actor: { id: user.id, name: user.name },
      }),
    );
    id = run.id;
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not start the payroll run.") };
  }

  revalidatePath("/dashboard/hr/payroll");
  redirect(`/dashboard/hr/payroll/${id}`);
}

export async function generatePayslips(runId: string): Promise<ActionResult> {
  try {
    const { processed, skipped } = await withAuthorizedTenant(
      PREPARE_ROLES,
      (tx, { user, companyId }) =>
        payroll.generateEntries(tx, {
          companyId,
          runId,
          actor: { id: user.id, name: user.name },
        }),
    );

    revalidatePath(`/dashboard/hr/payroll/${runId}`);
    return {
      success: true,
      id: runId,
      processed,
      skipped,
      message: skipped.length
        ? `${processed} payslip(s) prepared. ${skipped.length} could not be: ${skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}`
        : `${processed} payslip(s) prepared.`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not prepare the payslips.") };
  }
}

export async function submitForReview(runId: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant(PREPARE_ROLES, (tx, { user }) =>
      payroll.submitRunForReview(tx, {
        runId,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not send the run for review.") };
  }
  revalidatePath(`/dashboard/hr/payroll/${runId}`);
  revalidatePath("/dashboard/hr/payroll");
  return { success: true, id: runId };
}

/**
 * Approves and posts, together.
 *
 * The source approves, then tries to post, and on failure keeps the approval
 * with a warning — leaving a payroll approved, loans marked repaid, and
 * nothing in the books. Here a posting failure means the approval did not
 * happen, and the message names the accounts that need mapping.
 */
export async function approvePayrollRun(runId: string): Promise<ActionResult> {
  try {
    const { loansRepaid } = await withAuthorizedTenant(
      APPROVE_ROLES,
      (tx, { user, companyId }) =>
        payroll.approveRun(tx, {
          companyId,
          runId,
          actor: { id: user.id, name: user.name },
        }),
    );

    revalidatePath(`/dashboard/hr/payroll/${runId}`);
    revalidatePath("/dashboard/hr/payroll");
    return {
      success: true,
      id: runId,
      message: loansRepaid
        ? `Approved and posted. ${loansRepaid} loan instalment(s) recorded as repaid.`
        : "Approved and posted to the ledger.",
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not approve the payroll.") };
  }
}

export async function markPayrollPaid(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const runId = str(formData, "runId") || str(formData, "payrollRunId");
  if (!runId) return { success: false, error: "Payroll run ID is required" };

  try {
    await withAuthorizedTenant(APPROVE_ROLES, (tx, { user, companyId }) =>
      payroll.markRunPaid(tx, {
        companyId,
        runId,
        paymentReference: str(formData, "reference") || null,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not mark the payroll as paid.") };
  }

  revalidatePath(`/dashboard/hr/payroll/${runId}`);
  revalidatePath("/dashboard/hr/payroll");
  return { success: true, id: runId, message: "Marked as paid and posted to the ledger." };
}

export async function voidPayrollRun(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const runId = str(formData, "runId") || str(formData, "payrollRunId");
  const reason = str(formData, "reason");
  if (!runId) return { success: false, error: "Payroll run ID is required" };
  if (!reason) {
    return {
      success: false,
      error: "A void needs a reason",
      fieldErrors: { reason: "Required" },
    };
  }

  try {
    const { journalsReversed, installmentsRestored } = await withAuthorizedTenant(
      VOID_ROLES,
      (tx, { user, companyId }) =>
        payroll.voidRun(tx, {
          companyId,
          runId,
          reason,
          actor: { id: user.id, name: user.name },
        }),
    );

    revalidatePath(`/dashboard/hr/payroll/${runId}`);
    revalidatePath("/dashboard/hr/payroll");
    const parts = [];
    if (journalsReversed) parts.push(`${journalsReversed} journal(s) reversed`);
    if (installmentsRestored) {
      parts.push(`${installmentsRestored} loan instalment(s) returned to pending`);
    }
    return {
      success: true,
      id: runId,
      message: parts.length ? `Voided — ${parts.join(", ")}.` : "Voided.",
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not void the payroll.") };
  }
}

export async function updatePayslip(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const entryId = str(formData, "entryId");
  const runId = str(formData, "runId") || str(formData, "payrollRunId");
  if (!entryId) return { success: false, error: "Payslip ID is required" };

  const values: Record<string, number> = {};
  for (const key of [
    "basicSalary", "housingAllowance", "transportAllowance", "medicalAllowance",
    "otherAllowance", "overtimePay", "bonus", "commission",
    "paye", "nssf", "shif", "housingLevy", "insuranceRelief",
    "loanRepayment", "saccoDeduction",
  ]) {
    if (formData.has(key)) values[key] = num(formData, key);
  }

  try {
    await withAuthorizedTenant(PREPARE_ROLES, (tx, { user }) =>
      payroll.updateEntry(tx, {
        entryId,
        values,
        notes: formData.has("notes") ? str(formData, "notes") : undefined,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not update the payslip.") };
  }

  if (runId) revalidatePath(`/dashboard/hr/payroll/${runId}`);
  return { success: true, id: entryId };
}

export async function addPayslipLine(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const entryId = str(formData, "entryId");
  const description = str(formData, "description");
  const amount = num(formData, "amount");
  const kind = str(formData, "kind") === "deduction" ? "deduction" : "earning";

  if (!entryId || !description || !(amount > 0)) {
    return { success: false, error: "A description and an amount above zero are required." };
  }

  try {
    await withAuthorizedTenant(PREPARE_ROLES, (tx, { companyId }) =>
      payroll.addEntryLine(tx, {
        companyId,
        entryId,
        kind,
        description,
        amount,
        accountId: str(formData, "accountId") || null,
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not add the line.") };
  }

  const runId = str(formData, "runId");
  if (runId) revalidatePath(`/dashboard/hr/payroll/${runId}`);
  return { success: true, id: entryId };
}

export async function removePayslipLine(lineId: string, runId?: string) {
  try {
    await withAuthorizedTenant(PREPARE_ROLES, (tx) =>
      payroll.removeEntryLine(tx, lineId),
    );
  } catch (err) {
    return { success: false as const, error: userMessage(err, "Could not remove the line.") };
  }
  if (runId) revalidatePath(`/dashboard/hr/payroll/${runId}`);
  return { success: true as const };
}

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * The PAYE bands, from the form's indexed fields.
 *
 * `bracket_to_N` blank or zero means the top band, which has no ceiling.
 * Rates arrive as percentages because that is what a person types.
 */
function readBrackets(formData: FormData) {
  const brackets: Array<{ from: number; to: number | null; rate: number }> = [];
  for (let i = 0; formData.has(`bracket_from_${i}`); i++) {
    const from = Number(str(formData, `bracket_from_${i}`) || 0);
    const toRaw = str(formData, `bracket_to_${i}`);
    const to = toRaw === "" || toRaw === "0" ? null : Number(toRaw);
    const rate = Number(str(formData, `bracket_rate_${i}`) || 0) / 100;
    if (Number.isFinite(from) && Number.isFinite(rate) && rate > 0) {
      brackets.push({ from, to, rate });
    }
  }
  return brackets;
}

/** A percentage as typed, as the fraction the schema stores. */
const pct = (fd: FormData, key: string, fallback = 0) => {
  const v = Number(str(fd, key));
  return Number.isFinite(v) ? v / 100 : fallback;
};

export async function savePayrollRates(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const brackets = readBrackets(formData);
  if (!brackets.length) {
    return { success: false, error: "At least one PAYE band is required." };
  }
  if (!str(formData, "name")) {
    return { success: false, error: "Give this set of rates a name", fieldErrors: { name: "Required" } };
  }
  if (!str(formData, "effectiveFrom")) {
    return {
      success: false,
      error: "Say when these rates start applying",
      fieldErrors: { effectiveFrom: "Required" },
    };
  }

  try {
    await withAuthorizedTenant(CONFIG_ROLES, (tx, { user, companyId }) =>
      payroll.saveRates(tx, {
        companyId,
        id: str(formData, "configId") || undefined,
        name: str(formData, "name"),
        effectiveFrom: str(formData, "effectiveFrom"),
        effectiveTo: str(formData, "effectiveTo") || null,
        personalRelief: num(formData, "personalRelief"),
        insuranceReliefRate: formData.has("insuranceReliefRate")
          ? pct(formData, "insuranceReliefRate", 0.15)
          : 0.15,
        insuranceReliefCap: num(formData, "insuranceReliefCap", 5000),
        nssfTierILimit: num(formData, "nssfTierILimit"),
        nssfTierIILimit: num(formData, "nssfTierIILimit"),
        nssfEmployeeRate: pct(formData, "nssfEmployeeRate"),
        nssfEmployerRate: pct(formData, "nssfEmployerRate"),
        shifRate: pct(formData, "shifRate"),
        shifMinimum: num(formData, "shifMinimum", 300),
        ahlEmployeeRate: pct(formData, "ahlEmployeeRate"),
        ahlEmployerRate: pct(formData, "ahlEmployerRate"),
        brackets,
        notes: str(formData, "notes") || null,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not save the payroll rates.") };
  }

  revalidatePath("/dashboard/settings/payroll-config");
  return { success: true, message: "Payroll rates saved." };
}

export async function savePayrollGlMapping(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const configId = str(formData, "configId");
  if (!configId) return { success: false, error: "Choose which rates to map." };

  const mapping: Record<string, string | null> = {};
  for (const key of [
    "salaryExpense", "employerNssfExpense", "employerAhlExpense",
    "salaryPayable", "payePayable", "nssfPayable", "shifPayable",
    "ahlPayable", "bankAccount", "staffLoansReceivable", "interestIncome",
  ]) {
    if (formData.has(key)) mapping[key] = str(formData, key) || null;
  }

  try {
    await withAuthorizedTenant(CONFIG_ROLES, (tx, { user }) =>
      payroll.saveGlMapping(tx, {
        configId,
        mapping,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not save the account mapping.") };
  }

  revalidatePath("/dashboard/settings/payroll-config");
  return { success: true, message: "Account mapping saved." };
}

/**
 * Fills the GL mapping from the chart's own system-account markers.
 *
 * The standard chart already labels every account payroll needs — PAYE
 * payable, NSSF payable, salaries payable and the rest. Making somebody pick
 * eleven of them out of a dropdown, correctly, is a step that only exists
 * because nothing connected the two.
 *
 * Anything already mapped is left alone; anything the chart does not label is
 * reported so it can be chosen by hand.
 */
export async function autoMapPayrollAccounts(configId: string) {
  const WANTED: Array<[string, string]> = [
    ["salaryExpense", "salaries_expense"],
    ["employerNssfExpense", "employer_nssf_expense"],
    ["employerAhlExpense", "employer_ahl_expense"],
    ["salaryPayable", "salaries_payable"],
    ["payePayable", "paye_payable"],
    ["nssfPayable", "nssf_payable"],
    ["shifPayable", "shif_payable"],
    ["ahlPayable", "ahl_payable"],
    ["bankAccount", "cash_at_bank"],
    // Staff loans sit under employee advances in the standard chart.
    ["staffLoansReceivable", "employee_advance"],
  ];

  try {
    const result = await withAuthorizedTenant(
      CONFIG_ROLES,
      async (tx, { user }) => {
        const current = await payroll.getRatesById(tx, configId);
        if (!current) throw new Error("Those payroll rates no longer exist.");

        const mapping: Record<string, string | null> = {};
        const unmatched: string[] = [];

        for (const [field, marker] of WANTED) {
          if (current.glMapping[field]) continue;
          const account = await accounts.getSystemAccount(tx, marker);
          if (account) mapping[field] = account.id;
          else unmatched.push(field);
        }

        if (Object.keys(mapping).length) {
          await payroll.saveGlMapping(tx, {
            configId,
            mapping,
            actor: { id: user.id, name: user.name },
          });
        }
        return { mapped: Object.keys(mapping).length, unmatched };
      },
    );

    revalidatePath("/dashboard/settings/payroll-config");
    return {
      success: true as const,
      ...result,
      message: result.mapped
        ? `${result.mapped} account(s) mapped from the chart of accounts.` +
          (result.unmatched.length
            ? ` ${result.unmatched.length} could not be matched and need choosing by hand.`
            : "")
        : "Everything payroll needs is already mapped.",
    };
  } catch (err) {
    return {
      success: false as const,
      error: userMessage(err, "The accounts could not be mapped."),
    };
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listPayrollRunsForPage(
  opts: { status?: string; year?: number; page?: number; limit?: number } = {},
) {
  const limit = opts.limit ?? 20;
  const page = Math.max(opts.page ?? 1, 1);

  return withAuthorizedTenant(PREPARE_ROLES, async (tx) => {
    const { rows, total } = await payroll.listRuns(tx, {
      status: opts.status || null,
      year: opts.year || null,
      limit,
      offset: (page - 1) * limit,
    });
    return {
      runs: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  });
}

export async function getPayrollRunForPage(id: string, search?: string) {
  return withAuthorizedTenant(PREPARE_ROLES, async (tx, { user }) => {
    const run = await payroll.getRun(tx, id);
    if (!run) return null;
    const entries = await payroll.listEntries(tx, id, { search });
    return {
      run,
      entries,
      can: {
        prepare: roleAllowed(user.role, PREPARE_ROLES),
        approve: roleAllowed(user.role, APPROVE_ROLES),
        void: roleAllowed(user.role, VOID_ROLES),
      },
    };
  });
}

export async function getPayrollFormData() {
  return withAuthorizedTenant(PREPARE_ROLES, async (tx, { companyId }) => {
    const now = new Date();
    const [rates, existing] = await Promise.all([
      payroll.getRatesForPeriod(tx, now.getFullYear(), now.getMonth() + 1),
      tx.execute(sql`
        SELECT period_year, period_month FROM payroll_runs
         WHERE status <> 'voided'
         ORDER BY period_year DESC, period_month DESC
         LIMIT 24
      `),
    ]);

    return {
      hasRates: Boolean(rates),
      ratesName: rates?.name ?? null,
      companyId,
      // So the form can grey out months already run, rather than letting the
      // user submit and hit a unique-constraint error.
      taken: (existing as unknown as Array<{ period_year: number; period_month: number }>)
        .map((r) => `${r.period_year}-${r.period_month}`),
    };
  });
}

export async function getPayslipForPage(entryId: string) {
  return withAuthorizedTenant([], async (tx, { user }) => {
    const entry = await payroll.getEntry(tx, entryId);
    if (!entry) return null;

    // Anybody in HR or finance may open any payslip; an employee may open
    // their own.
    if (!roleAllowed(user.role, PREPARE_ROLES)) {
      const me = await employees.getEmployeeByUser(tx, user.id);
      if (!me || me.id !== entry.employeeId) return null;
    }

    const employee = await employees.getEmployee(tx, entry.employeeId);
    return { entry, employee };
  });
}

export async function getMyPayslips(year?: number) {
  return withAuthorizedTenant([], async (tx, { user }) => {
    const me = await employees.getEmployeeByUser(tx, user.id);
    if (!me) return { employee: null, payslips: [] };
    const payslips = await payroll.listEmployeePayslips(tx, {
      employeeId: me.id,
      year: year ?? null,
    });
    return {
      employee: { id: me.id, name: me.fullName, employeeNumber: me.employeeNumber },
      payslips,
    };
  });
}

export async function getEmployeePayslips(employeeId: string) {
  return withAuthorizedTenant([...HR_VIEW_ROLES], (tx) =>
    payroll.listEmployeePayslips(tx, { employeeId }),
  );
}

export async function getP9ForPage(employeeId: string, year: number) {
  return withAuthorizedTenant([], async (tx, { user }) => {
    if (!roleAllowed(user.role, PREPARE_ROLES)) {
      const me = await employees.getEmployeeByUser(tx, user.id);
      if (!me || me.id !== employeeId) return null;
    }
    const [employee, months] = await Promise.all([
      employees.getEmployee(tx, employeeId),
      payroll.getP9Data(tx, { employeeId, year }),
    ]);
    if (!employee) return null;
    return { employee, months, year };
  });
}

/** Settings → Payroll: the rate configurations and the accounts to map to. */
export async function getPayrollSettings() {
  return withAuthorizedTenant(CONFIG_ROLES, async (tx) => {
    const [configs, postable] = await Promise.all([
      payroll.listRateConfigs(tx),
      accounts.listAccounts(tx, { activeOnly: true, postableOnly: true }),
    ]);
    const active = configs.length
      ? await payroll.getRatesById(tx, configs[0].id)
      : null;
    return {
      configs,
      accounts: postable.map((a) => ({
        id: a.id,
        code: a.accountCode,
        name: a.accountName,
        type: a.accountType,
      })),
      active,
    };
  });
}
