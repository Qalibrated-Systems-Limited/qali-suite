import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
  opts: { activeOnly?: boolean; postableOnly?: boolean } = {},
) {
  const conditions = [];
  if (opts.activeOnly !== false) conditions.push(eq(accounts.isActive, true));
  if (opts.postableOnly) conditions.push(eq(accounts.canPost, true));

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
