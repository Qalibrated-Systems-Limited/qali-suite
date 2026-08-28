"use server";

import { withAuthorizedTenant } from "../tenant";
import * as movementsRepo from "../repositories/stockMovements";

/**
 * The movements ledger screens.
 *
 * The TABLE has been Postgres since 0013 and the SCREENS reading it were the
 * last Mongo thing in inventory: `movement-queries.js` browsed a collection
 * nothing has written since, so the ledger showed an empty history of stock
 * that had demonstrably moved.
 *
 * ROLE SCOPE IS DECIDED HERE and enforced inside the query. Admin, Manager and
 * Store Manager see every movement; anyone else sees the ones they performed
 * or received. The Mongo version took `userId` and `userRole` as ARGUMENTS
 * from the page, so a page that passed neither — and one of the two did not
 * pass them — got everything.
 */
const SEE_ALL_MOVEMENTS = new Set([
  "SuperAdmin",
  "Admin",
  "Store Manager",
  "Manager",
]);

export interface MovementFilters {
  search?: string | null;
  movementType?: string | null;
  direction?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  productId?: string | null;
  page?: number;
}

function scopeFor(
  user: { id?: string | null; role?: string },
  filters: MovementFilters,
) {
  return {
    ...filters,
    restrictToUserId: SEE_ALL_MOVEMENTS.has(user.role ?? "")
      ? null
      : (user.id ?? null),
  };
}

export async function searchMovementsPg(filters: MovementFilters = {}) {
  return withAuthorizedTenant([], (tx, { user }) =>
    movementsRepo.browseMovements(tx, scopeFor(user, filters)),
  );
}

export async function fetchMovementPagesPg(filters: MovementFilters = {}) {
  return withAuthorizedTenant([], (tx, { user }) =>
    movementsRepo.countMovementPages(tx, scopeFor(user, filters)),
  );
}

export async function getMovementStatsPg(filters: MovementFilters = {}) {
  return withAuthorizedTenant([], (tx, { user }) =>
    movementsRepo.getMovementBrowseStats(tx, scopeFor(user, filters)),
  );
}

export async function getMovementByIdPg(movementId: string) {
  return withAuthorizedTenant([], (tx) =>
    movementsRepo.getMovementForScreen(tx, movementId),
  );
}
