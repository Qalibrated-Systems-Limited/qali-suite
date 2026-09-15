import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { isUuid, toDate } from "./sqlHelpers";
import type { Tx } from "../client";
import { accounts } from "../schema";

/**
 * Chart-of-accounts repository.
 *
 * See docs/POSTGRES-MIGRATION-PLAN.md §4.1 for the layering rule: all SQL for
 * accounts lives here, and nothing here reads the session.
 */

export interface CreateAccountInput {
  companyId: string;
  accountCode: string;
  accountName: string;
  accountType: "asset" | "liability" | "equity" | "revenue" | "expense";
  subType?: string | null;
  parentId?: string | null;
  systemAccount?: string | null;
  currency?: string;
  description?: string | null;
  taxable?: boolean;
  defaultTaxRate?: string;
  createdById?: string | null;
}

/**
 * Header accounts (subType 'header') are structural and cannot be posted to.
 * Same rule as the Mongo layer, kept in one place instead of recomputed at
 * each call site.
 */
const canPostFor = (subType?: string | null) => subType !== "header";

export async function createAccount(tx: Tx, input: CreateAccountInput) {
  if (input.parentId) {
    const [parent] = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.id, input.parentId));

    if (!parent) throw new Error("Parent account not found");
    if (parent.subType !== "header") {
      throw new Error("Parent must be a header account");
    }
    if (parent.accountType !== input.accountType) {
      throw new Error(
        `Parent account type (${parent.accountType}) must match account type (${input.accountType})`,
      );
    }
  }

  const [created] = await tx
    .insert(accounts)
    .values({
      companyId: input.companyId,
      accountCode: input.accountCode.toUpperCase(),
      accountName: input.accountName,
      accountType: input.accountType,
      subType: input.subType ?? null,
      // NOTE: this is the field the Mongo path silently dropped — see
      // getAccountHierarchy() below.
      parentId: input.parentId ?? null,
      canPost: canPostFor(input.subType),
      systemAccount: input.systemAccount ?? null,
      currency: input.currency ?? "KES",
      description: input.description ?? null,
      taxable: input.taxable ?? false,
      defaultTaxRate: input.defaultTaxRate ?? "0",
      createdById: input.createdById ?? null,
    })
    .returning();

  // Materialise the ltree path now that we know our own id. Account codes are
  // alphanumeric, which is already a valid ltree label.
  await tx.execute(sql`
    UPDATE accounts SET path = (
      CASE WHEN ${created.parentId}::uuid IS NULL
           THEN ${created.accountCode}::ltree
           ELSE (SELECT p.path FROM accounts p WHERE p.id = ${created.parentId}::uuid)
                || ${created.accountCode}::ltree
      END
    ),
    level = (
      CASE WHEN ${created.parentId}::uuid IS NULL THEN 0
           ELSE (SELECT p.level + 1 FROM accounts p WHERE p.id = ${created.parentId}::uuid)
      END
    )
    WHERE id = ${created.id}
  `);

  return created;
}

/**
 * The full chart of accounts as a nested tree.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This function exists to fix a live bug in the Mongo implementation.
 *
 * The Mongoose schema field is `parentAccount`. But the account form submits a
 * hidden input named `parentId`, the Zod schema validates `parentId`, and
 * createAccount() then does `Account.create({ ...data })` — spreading a
 * `parentId` key into a schema that has no such path. Mongoose runs in strict
 * mode by default and SILENTLY DROPS unknown fields, so the parent is never
 * persisted. getAccountHierarchy() then reads `account.parentId`, which is
 * also absent, so every account falls through to the root branch.
 *
 * Net effect today: choosing a parent account in the UI does nothing, and the
 * chart of accounts is permanently flat — even though the validation code
 * immediately above the save DOES look the parent up and check its type, which
 * makes the feature look like it works.
 *
 * In Postgres this class of bug cannot occur: `parent_id` is a real column with
 * a foreign key, so a wrong field name is a hard error at insert time rather
 * than a silent discard.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface AccountNode {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  subType: string | null;
  canPost: boolean;
  parentId: string | null;
  level: number;
  children: AccountNode[];
}

export async function getAccountHierarchy(tx: Tx): Promise<AccountNode[]> {
  const rows = await tx
    .select({
      id: accounts.id,
      accountCode: accounts.accountCode,
      accountName: accounts.accountName,
      accountType: accounts.accountType,
      subType: accounts.subType,
      canPost: accounts.canPost,
      parentId: accounts.parentId,
      level: accounts.level,
    })
    .from(accounts)
    .where(eq(accounts.isActive, true))
    .orderBy(asc(accounts.accountCode));

  const byId = new Map<string, AccountNode>(
    rows.map((r) => [r.id, { ...r, children: [] } as AccountNode]),
  );

  const roots: AccountNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    const parent = row.parentId ? byId.get(row.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * Every descendant of an account, using the ltree path.
 *
 * The Mongo equivalent maintained an `ancestors[]` array on every document,
 * rewritten on each move. `<@` is a single indexed operator against the GiST
 * index created in migration 0001.
 */
export async function getDescendants(tx: Tx, accountId: string) {
  return tx.execute(sql`
    SELECT d.id, d.account_code, d.account_name, d.level
      FROM accounts a
      JOIN accounts d ON d.path <@ a.path AND d.id <> a.id
     WHERE a.id = ${accountId}
     ORDER BY d.path
  `);
}

export async function listAccounts(
  tx: Tx,
  opts: {
    activeOnly?: boolean;
    postableOnly?: boolean;
    /** 0059 — the expense form needs the postable expense accounts only. */
    accountType?: (typeof accounts.accountType.enumValues)[number];
  } = {},
) {
  const conditions = [];
  if (opts.activeOnly !== false) conditions.push(eq(accounts.isActive, true));
  if (opts.postableOnly) conditions.push(eq(accounts.canPost, true));
  if (opts.accountType) {
    conditions.push(eq(accounts.accountType, opts.accountType));
  }

  return tx
    .select()
    .from(accounts)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(accounts.accountCode));
}

/**
 * Balance for one account, read from the account_balances view.
 *
 * Replaces calculateActualBalance(), which aggregated the whole
 * journalentries collection with no companyId in its $match and then wrote the
 * result back to a cached field. Nothing is cached here, so nothing can drift.
 */
/**
 * Resolves a system account by its role — "accounts_receivable", "vat_output",
 * "grni" and so on.
 *
 * Every posting path needs this, and it belongs here rather than in each
 * action: the repositories take account ids because they must not read
 * configuration, so something has to turn a role into an id, once.
 *
 * Returns null when the role is not configured. Callers decide whether that is
 * fatal — a missing VAT Output account only matters if the document carries
 * VAT, and refusing every invoice over a control account that is never used
 * would be wrong.
 */
export async function getSystemAccount(tx: Tx, systemAccount: string) {
  const [account] = await tx
    .select({
      id: accounts.id,
      accountCode: accounts.accountCode,
      accountName: accounts.accountName,
      accountType: accounts.accountType,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.systemAccount, systemAccount),
        eq(accounts.isActive, true),
      ),
    );
  return account ?? null;
}

/** Cash, bank and M-Pesa accounts — what a payment can be received into. */
export async function listPaymentAccounts(tx: Tx) {
  const rows = await tx
    .select({
      id: accounts.id,
      accountName: accounts.accountName,
      accountCode: accounts.accountCode,
      subType: accounts.subType,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.accountType, "asset"),
        eq(accounts.isActive, true),
        // A header account cannot be posted to, so offering one as a payment
        // target is offering a payment that the ledger will refuse. The Mongo
        // claims query asked for `canPost: true` and this did not.
        eq(accounts.canPost, true),
        inArray(accounts.subType, ["cash", "bank", "mpesa"]),
      ),
    )
    .orderBy(asc(accounts.accountName));

  return rows.map((a) => ({
    _id: a.id,
    name: a.accountName,
    code: a.accountCode,
    subType: a.subType,
  }));
}

export async function getAccountBalance(tx: Tx, accountId: string) {
  const [row] = (await tx.execute(sql`
    SELECT account_id, account_code, account_name,
           total_debit, total_credit, balance
      FROM account_balances
     WHERE account_id = ${accountId}
  `)) as unknown as Array<Record<string, unknown>>;

  return row ?? null;
}

/**
 * Deactivate, preserving the two guards the Mongo action enforced: system
 * accounts are protected, and an account carrying posted transactions cannot
 * be deactivated.
 */
export async function deactivateAccount(tx: Tx, accountId: string) {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId));

  if (!account) throw new Error("Account not found");
  if (account.systemAccount) {
    throw new Error(
      "Cannot deactivate system accounts. They are required for operations.",
    );
  }

  const [{ count }] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS count
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.account_id = ${accountId} AND e.status = 'posted'
  `)) as unknown as Array<{ count: number }>;

  if (count > 0) {
    throw new Error(
      `Cannot deactivate account with ${count} posted transactions.`,
    );
  }

  const [updated] = await tx
    .update(accounts)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(accounts.id, accountId))
    .returning();

  return updated;
}

export async function activateAccount(tx: Tx, accountId: string) {
  const [updated] = await tx
    .update(accounts)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(accounts.id, accountId))
    .returning();

  if (!updated) throw new Error("Account not found");
  return updated;
}

/**
 * The chart of accounts as a tree, grouped by type, with balances.
 *
 * What the accounts page renders. The Mongo equivalent read a `cachedBalance`
 * field that calculateActualBalance() wrote back after aggregating the whole
 * journal — §4.4's stored-derived-value problem, and the reason a balance could
 * disagree with its own entries. Here it comes from the account_balances view,
 * in ONE query for the whole chart rather than one per account.
 */
export async function getAccountsGrouped(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT a.id, a.account_code, a.account_name, a.account_type, a.sub_type,
           a.parent_id, a.can_post, a.is_active, a.system_account,
           COALESCE(b.balance, 0)::numeric(19,4) AS balance
      FROM accounts a
      LEFT JOIN account_balances b ON b.account_id = a.id
     WHERE a.is_active = true
     ORDER BY a.account_code
  `)) as unknown as Array<Record<string, unknown>>;

  type Node = {
    _id: string;
    accountCode: string;
    accountName: string;
    accountType: string;
    subType: string | null;
    parentId: string | null;
    canPost: boolean;
    isActive: boolean;
    systemAccount: string | null;
    cachedBalance: number;
    children: Node[];
  };

  // `_id` and `cachedBalance` are the client component's names. It was written
  // against Mongo documents; shaping here beats redesigning it, and the value
  // behind cachedBalance is no longer cached — it is the view's.
  const byId = new Map<string, Node>();
  for (const r of rows) {
    byId.set(String(r.id), {
      _id: String(r.id),
      accountCode: String(r.account_code),
      accountName: String(r.account_name),
      accountType: String(r.account_type),
      subType: (r.sub_type as string) ?? null,
      parentId: (r.parent_id as string) ?? null,
      canPost: Boolean(r.can_post),
      isActive: Boolean(r.is_active),
      systemAccount: (r.system_account as string) ?? null,
      cachedBalance: Number(r.balance ?? 0),
      children: [],
    });
  }

  const grouped: Record<string, Node[]> = {};
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) {
      parent.children.push(node);
      continue;
    }
    (grouped[node.accountType] ??= []).push(node);
  }
  return grouped;
}

/** One account, with its derived balance. */
export async function getAccount(tx: Tx, accountId: string) {
  // An id a uuid column cannot hold is NOT FOUND, not a 22P02 with
  // the statement in the message. See isUuid in sqlHelpers.
  if (!isUuid(accountId)) return null;
  const rows = (await tx.execute(sql`
    SELECT a.*, COALESCE(b.balance, 0)::numeric(19,4) AS balance,
           COALESCE(b.total_debit, 0)::numeric(19,4)  AS total_debit,
           COALESCE(b.total_credit, 0)::numeric(19,4) AS total_credit,
           p.account_code AS parent_code, p.account_name AS parent_name
      FROM accounts a
      LEFT JOIN account_balances b ON b.account_id = a.id
      LEFT JOIN accounts p ON p.id = a.parent_id
     WHERE a.id = ${accountId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  if (!rows.length) return null;
  const r = rows[0];
  return {
    _id: String(r.id),
    id: String(r.id),
    accountCode: String(r.account_code),
    accountName: String(r.account_name),
    accountType: String(r.account_type),
    subType: (r.sub_type as string) ?? null,
    parentId: (r.parent_id as string) ?? null,
    parentCode: (r.parent_code as string) ?? null,
    parentName: (r.parent_name as string) ?? null,
    canPost: Boolean(r.can_post),
    isActive: Boolean(r.is_active),
    systemAccount: (r.system_account as string) ?? null,
    description: (r.description as string) ?? null,
    cachedBalance: Number(r.balance ?? 0),
    totalDebit: Number(r.total_debit ?? 0),
    totalCredit: Number(r.total_credit ?? 0),
  };
}

/**
 * Edits an account's own fields.
 *
 * The CODE AND TYPE ARE NOT EDITABLE once entries exist: a posted line belongs
 * to an account of a type, and changing that type retrospectively reclassifies
 * history — an asset becoming an expense rewrites every report that ever ran.
 * The source allowed it. Refused here, with the reason.
 */
export async function updateAccount(
  tx: Tx,
  accountId: string,
  input: {
    accountName?: string;
    subType?: string | null;
    description?: string | null;
    /** Constrained to the ledger's five types — the column is an enum. */
    accountType?: "asset" | "liability" | "equity" | "revenue" | "expense";
    accountCode?: string;
  },
) {
  const [existing] = await tx.select().from(accounts).where(eq(accounts.id, accountId));
  if (!existing) throw new Error("Account not found");

  const typeChanging =
    input.accountType != null && input.accountType !== existing.accountType;
  const codeChanging =
    input.accountCode != null &&
    input.accountCode.toUpperCase() !== existing.accountCode;

  if (typeChanging || codeChanging) {
    const [{ n }] = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM journal_lines WHERE account_id = ${accountId}::uuid
    `)) as unknown as Array<{ n: number }>;
    if (Number(n) > 0) {
      throw new Error(
        `This account has ${n} posted line(s); its code and type can no longer change. Deactivate it and create a new one.`,
      );
    }
  }

  const [updated] = await tx
    .update(accounts)
    .set({
      accountName: input.accountName ?? existing.accountName,
      subType: input.subType !== undefined ? input.subType : existing.subType,
      description:
        input.description !== undefined ? input.description : existing.description,
      accountType: input.accountType ?? existing.accountType,
      accountCode: input.accountCode
        ? input.accountCode.toUpperCase()
        : existing.accountCode,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, accountId))
    .returning();
  return updated;
}

/** Counts for the cards above the chart. */
export async function getAccountStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*)::int                                        AS total,
           COUNT(*) FILTER (WHERE is_active)::int               AS active,
           COUNT(*) FILTER (WHERE can_post)::int                AS postable,
           COUNT(*) FILTER (WHERE system_account IS NOT NULL)::int AS system
      FROM accounts
  `)) as unknown as Array<Record<string, unknown>>;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    total: n(row?.total),
    active: n(row?.active),
    postable: n(row?.postable),
    system: n(row?.system),
    totalAccounts: n(row?.total),
    activeAccounts: n(row?.active),
  };
}

/**
 * The account ledger: every posted line, with a running balance.
 *
 * Computed in SQL with a window function rather than accumulated in JavaScript,
 * so the running total is exact decimal arithmetic and the rows arrive already
 * in order.
 */
export async function getAccountLedger(
  tx: Tx,
  accountId: string,
  opts: { limit?: number; startDate?: string; endDate?: string } = {},
) {
  const where = [sql`jl.account_id = ${accountId}::uuid`];
  if (opts.startDate) where.push(sql`je.entry_date >= ${opts.startDate}::date`);
  if (opts.endDate) where.push(sql`je.entry_date <= ${opts.endDate}::date`);

  const rows = (await tx.execute(sql`
    SELECT je.id AS entry_id, je.entry_number, je.entry_date, je.description,
           je.reference, jl.debit, jl.credit, jl.description AS line_description,
           SUM(jl.debit - jl.credit) OVER (
             ORDER BY je.entry_date, je.entry_number, jl.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           )::numeric(19,4) AS running_balance
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
     WHERE ${sql.join(where, sql` AND `)}
     ORDER BY je.entry_date, je.entry_number, jl.id
     LIMIT ${Math.min(opts.limit ?? 200, 500)}
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    entryId: String(r.entry_id),
    entryNumber: String(r.entry_number),
    entryDate: toDate(r.entry_date)!,
    description: (r.description as string) ?? null,
    lineDescription: (r.line_description as string) ?? null,
    reference: (r.reference as string) ?? null,
    debit: Number(r.debit ?? 0),
    credit: Number(r.credit ?? 0),
    runningBalance: Number(r.running_balance ?? 0),
  }));
}

/**
 * An account's opening and closing position over a window, from POSTED lines.
 *
 * Built for the petty cash statement, which calls the GL "the single
 * source of truth for the balances" and then computes them from a Mongo
 * aggregate. Opening is the net of every posted line dated BEFORE `from`, so
 * opening balances and prior periods are reflected without being seeded;
 * closing is the net through `to`. One pass, split by date.
 *
 * Returns strings — numeric(19,4), summed in the database, so a float never
 * touches the figure.
 */
export async function getAccountPosition(
  tx: Tx,
  accountId: string,
  opts: { from: string; to: string },
) {
  const [row] = (await tx.execute(sql`
    SELECT
      COALESCE(SUM(jl.debit - jl.credit)
               FILTER (WHERE je.entry_date < ${opts.from}::date), 0)::text AS opening,
      COALESCE(SUM(jl.debit - jl.credit), 0)::text                          AS closing,
      COALESCE(SUM(jl.debit)
               FILTER (WHERE je.entry_date BETWEEN ${opts.from}::date AND ${opts.to}::date), 0)::text AS period_debit,
      COALESCE(SUM(jl.credit)
               FILTER (WHERE je.entry_date BETWEEN ${opts.from}::date AND ${opts.to}::date), 0)::text AS period_credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
     WHERE jl.account_id = ${accountId}::uuid
       AND je.status = 'posted'
       AND je.entry_date <= ${opts.to}::date
  `)) as unknown as Array<Record<string, string>>;

  return {
    opening: row?.opening ?? "0",
    closing: row?.closing ?? "0",
    periodDebit: row?.period_debit ?? "0",
    periodCredit: row?.period_credit ?? "0",
  };
}

/**
 * Posted entries that DEBIT an account over a window — money in.
 *
 * The petty cash statement's top-up rows: a float receipt is any posted entry
 * that debits the float, whatever raised it.
 */
export async function listAccountDebits(
  tx: Tx,
  accountId: string,
  opts: { from: string; to: string },
) {
  const rows = (await tx.execute(sql`
    SELECT je.entry_number, je.entry_date, je.description, jl.debit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
     WHERE jl.account_id = ${accountId}::uuid
       AND je.status = 'posted'
       AND jl.debit > 0
       AND je.entry_date BETWEEN ${opts.from}::date AND ${opts.to}::date
     ORDER BY je.entry_date, je.entry_number
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    entryNumber: String(r.entry_number),
    entryDate: toDate(r.entry_date)!,
    description: (r.description as string) ?? null,
    amount: String(r.debit ?? "0"),
  }));
}

// ── Keeping an existing chart up to date — the settings port ────────────────

/**
 * The two accounts the overpayment flows need, by their system handle.
 *
 * A READ. `AccountSetupCard` used to answer this by calling
 * `ensureAdvanceAccountsExist()` from a `useEffect` on mount — an action that
 * CREATES the accounts as a side effect. Opening the settings page therefore
 * wrote to the chart of accounts, every time, and the card's "Checking account
 * setup…" label described something that was not a check.
 */
export async function getAdvanceAccountStatus(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT system_account, account_code, account_name
      FROM accounts
     WHERE system_account IN ('supplier_advance', 'customer_advance')
  `)) as unknown as Array<Record<string, unknown>>;

  const byHandle = new Map(rows.map((r) => [String(r.system_account), r]));
  const describe = (handle: string, label: string) => {
    const row = byHandle.get(handle);
    return {
      handle,
      label,
      exists: Boolean(row),
      accountCode: row ? String(row.account_code) : null,
      accountName: row ? String(row.account_name) : null,
    };
  };

  const accountsFound = [
    describe("supplier_advance", "Supplier Advance"),
    describe("customer_advance", "Customer Advance"),
  ];

  return {
    complete: accountsFound.every((a) => a.exists),
    accounts: accountsFound,
  };
}

interface SyncActor {
  id?: string | null;
}

/**
 * Bring a company's chart up to the standard one, without touching what is
 * already there.
 *
 * THE MONGO VERSION WROTE TO A STORE NOTHING READS. `syncChartOfAccounts` and
 * `ensureAdvanceAccountsExist` created MONGO `Account` documents, while every
 * account screen has read Postgres since §9C. Both buttons reported success
 * and changed nothing anybody could see — the §9E defect, in Settings.
 *
 * Three passes, and each is idempotent on its own so a partial previous run
 * cannot confuse the next one:
 *
 *   1. INSERT the codes this company does not have. `ON CONFLICT DO NOTHING`
 *      against `accounts_company_code_uq` rather than a read-then-diff, so two
 *      people pressing Sync together cannot both insert the same code.
 *   2. Wire the parent of what pass 1 CREATED, and demote that parent to
 *      `can_post = false`. An account that was already there keeps the parent
 *      it has — a sync fills gaps, it does not restructure a chart somebody
 *      arranged deliberately. Then repair `path` and `level` across the chart
 *      from the parent links that actually exist, which changes no structure
 *      and writes down the one that is there.
 *   3. Backfill `system_account` where the seed defines a handle and the
 *      existing row has none. NEVER clobber a handle somebody set, and never
 *      when another account already claims it — `accounts_company_system_uq`
 *      is a partial UNIQUE, so a blind backfill aborts the whole sync on the
 *      first company that had tagged its own account.
 */
export async function syncStandardChart(
  tx: Tx,
  companyId: string,
  definitions: Array<{
    accountCode: string;
    accountName: string;
    accountType: string;
    subType?: string | null;
    parentCode?: string | null;
    canPost?: boolean;
    systemAccount?: string | null;
    description?: string | null;
  }>,
  actor: SyncActor = {},
) {
  // ── Pass 1: the codes that are missing ───────────────────────────────────
  const created: Array<{ accountCode: string; accountName: string }> = [];

  for (const a of definitions) {
    const [row] = (await tx.execute(sql`
      INSERT INTO accounts (
        company_id, account_code, account_name, account_type, sub_type,
        can_post, system_account, description, is_active, level, created_by_id
      ) VALUES (
        ${companyId}::uuid, ${a.accountCode}, ${a.accountName},
        ${a.accountType}::account_type, ${a.subType ?? null},
        ${a.canPost !== false}, ${a.systemAccount ?? null},
        ${a.description ?? null}, true, 0, ${actor.id ?? null}
      )
      ON CONFLICT (company_id, account_code) DO NOTHING
      RETURNING account_code, account_name
    `)) as unknown as Array<Record<string, unknown>>;

    if (row) {
      created.push({
        accountCode: String(row.account_code),
        accountName: String(row.account_name),
      });
    }
  }

  // ── Pass 2: the hierarchy ────────────────────────────────────────────────
  //
  // ONLY FOR WHAT THIS RUN CREATED. An account that was already there keeps
  // the parent it has, and this was NOT the first version of this function:
  // wiring every seed code to the seed's parent looks tidier and would force
  // a company that deliberately restructured its chart back to the standard
  // shape, demoting accounts they post to into headers on the way. A sync
  // fills gaps; it does not have opinions about what is already there.
  const createdCodes = new Set(created.map((c) => c.accountCode));

  const idByCode = new Map<string, string>();
  const existing = (await tx.execute(sql`
    SELECT id, account_code FROM accounts WHERE company_id = ${companyId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  for (const r of existing) idByCode.set(String(r.account_code), String(r.id));

  let demoted = 0;
  for (const a of definitions) {
    if (!a.parentCode || !createdCodes.has(a.accountCode)) continue;
    const childId = idByCode.get(a.accountCode);
    const parentId = idByCode.get(a.parentCode);
    if (!childId || !parentId) continue;

    await tx.execute(sql`
      UPDATE accounts SET parent_id = ${parentId}::uuid, updated_at = now()
       WHERE id = ${childId}::uuid
    `);

    // A parent with a child is structural. Posting to "Current Assets"
    // rather than to an account under it is how a chart stops meaning
    // anything, and it is the rule the provisioning seeder applies too.
    const [row] = (await tx.execute(sql`
      UPDATE accounts SET can_post = false, updated_at = now()
       WHERE id = ${parentId}::uuid AND can_post = true
      RETURNING id
    `)) as unknown as Array<Record<string, unknown>>;
    if (row) demoted++;
  }

  /*
   * The ltree path and the level, derived from the parent links the company
   * ACTUALLY has — not from the seed's. Pure repair: it changes no structure,
   * it writes down the structure that is there.
   *
   * It has to run over the whole chart rather than the new rows alone, because
   * `seedChartOfAccounts` in provisioning.ts set `parent_id` and `level` and
   * never set `path` — so every company provisioned to date has a chart of
   * NULL ltree paths, and `getDescendants()` walks `path <@ path`, which
   * matches nothing against a NULL. (provisioning.ts is fixed in the same
   * change, so new companies do not arrive needing this.)
   *
   * The depth cap is a cycle guard. `accounts.parent_id` is a self-referencing
   * foreign key with nothing preventing A → B → A, and a recursive CTE meeting
   * one does not return.
   */
  const repaired = (await tx.execute(sql`
    WITH RECURSIVE tree AS (
      SELECT id, account_code, account_code::ltree AS new_path, 0 AS new_level
        FROM accounts
       WHERE company_id = ${companyId}::uuid AND parent_id IS NULL

      UNION ALL

      SELECT c.id, c.account_code,
             t.new_path || c.account_code::ltree, t.new_level + 1
        FROM accounts c
        JOIN tree t ON c.parent_id = t.id
       WHERE c.company_id = ${companyId}::uuid
         AND t.new_level < 20
    )
    UPDATE accounts a
       SET path = t.new_path, level = t.new_level, updated_at = now()
      FROM tree t
     WHERE a.id = t.id
       AND (a.path IS DISTINCT FROM t.new_path
            OR a.level IS DISTINCT FROM t.new_level)
    RETURNING a.id
  `)) as unknown as Array<Record<string, unknown>>;
  const rewired = repaired.length;

  // ── Pass 3: the missing system handles ───────────────────────────────────
  let tagged = 0;
  for (const a of definitions) {
    if (!a.systemAccount) continue;
    const [row] = (await tx.execute(sql`
      UPDATE accounts
         SET system_account = ${a.systemAccount}, updated_at = now()
       WHERE company_id = ${companyId}::uuid
         AND account_code = ${a.accountCode}
         AND COALESCE(system_account, '') = ''
         AND NOT EXISTS (
           SELECT 1 FROM accounts other
            WHERE other.company_id = ${companyId}::uuid
              AND other.system_account = ${a.systemAccount}
         )
      RETURNING account_code
    `)) as unknown as Array<Record<string, unknown>>;
    if (row) tagged++;
  }

  return { created, tagged, rewired, demoted };
}
