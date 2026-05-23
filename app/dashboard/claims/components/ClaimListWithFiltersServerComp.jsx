import {
  searchClaims,
  searchUserClaims,
} from "@/app/mongodb/queries/claimQueries";
import { auth } from "@/auth";
import React from "react";
import { ClaimsListWithFilters } from "./ClaimListWithFilter";
import { serializeBsonType } from "@/lib/utils";

async function ClaimListWithFiltersServerComp({ AreMyclaims = true, params }) {
  const session = await auth();
  if (!session?.user) return null;

  const query = params?.query || "";
  const status = params?.status || "all";
  const claimType = params?.type || "all";
  const currentPage = Number(params?.page) || 1;
  const { user } = session;

  let userRole = user.role || "user";
  if (userRole !== "Store Manager" && userRole !== "Admin") {
    userRole = userRole.toLowerCase();
  }

  const filters = { status, claimType };
  let claims = [];

  if (AreMyclaims) {
    claims = await searchUserClaims(
      user.id,
      userRole,
      query,
      currentPage,
      filters
    );

    return (
      <ClaimsListWithFilters
        claims={claims}
        currentStatus={status}
        currentType={claimType}
        emptyMessage="You haven't submitted any claims yet"
      />
    );
  }

  claims = await searchClaims(query, currentPage, filters);
  if (claims && claims.length > 0) {
    claims = serializeBsonType(claims);
  }

  return (
    <ClaimsListWithFilters
      claims={claims}
      currentStatus={status}
      currentType={claimType}
      showStatusFilter={true}
      showTypeFilter={true}
      emptyMessage="No claims found"
    />
  );
}

export default ClaimListWithFiltersServerComp;
export { ClaimListWithFiltersServerComp };
