"use server";

import { withAuthorizedTenant } from "../tenant";
import * as expensesRepo from "../repositories/expenses";
import * as accountsRepo from "../repositories/accounts";

/**
 * The Postgres half of the petty cash statement.
 *
 * A read-only bridge, and a deliberately small one. `computePettyCashStatement`
 * still lives in app/mongodb/queries/petty-cash-queries.js because petty cash
 * itself is not ported — its postings still go into the Mongo ledger. What has
 * moved is everything the statement READS: the float's GL position and the
 * expenses paid out of it.
 *
 * This is the coupling §9J warned about, resolved in the order it prescribed.
 * The statement calls the GL "the single source of truth for the balances" and
 * takes the spend rows from expenses; both were Mongo, so it was self-
 * consistent inside one store. Moving expenses (0059) without moving this
 * would have left the balances in one store and the spend in the other.
 *
 * When petty-cash-actions.js moves, this file folds into the petty cash
 * actions and stops existing.
 */

export async function listExpensesPaidFromPg(
  accountId: string,
  opts: { from: string; to: string },
) {
  return withAuthorizedTenant([], (tx) =>
    expensesRepo.listExpensesPaidFrom(tx, accountId, opts),
  );
}

export async function getAccountPositionPg(
  accountId: string,
  opts: { from: string; to: string },
) {
  return withAuthorizedTenant([], (tx) =>
    accountsRepo.getAccountPosition(tx, accountId, opts),
  );
}

export async function listAccountDebitsPg(
  accountId: string,
  opts: { from: string; to: string },
) {
  return withAuthorizedTenant([], (tx) =>
    accountsRepo.listAccountDebits(tx, accountId, opts),
  );
}
