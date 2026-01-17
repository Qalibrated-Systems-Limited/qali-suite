import {
  getPartiesPaginated,
  fetchPartyPages,
} from "@/app/mongodb/queries/partyQueries";
import Pagination from "@/components/pagination";
import Search from "@/components/search";
import PartyListClient from "../components/partylistClient";
import { auth } from "@/auth";

export const metadata = {
  title: "Parties | ERP System",
  description: "Manage customers, suppliers, and employees",
};

export default async function PartiesPage({ searchParams }) {
  const params = await searchParams;
  const session = await auth();

  const query = params?.query || "";
  const type = params?.type || "all"; // all, customer, supplier, employee
  const currentPage = Number(params?.page) || 1;

  const { user } = session;

  // Fetch data
  const totalPages = await fetchPartyPages(query, type === "all" ? null : type);
  const parties = await getPartiesPaginated(
    query,
    currentPage,
    type === "all" ? null : type
  );

  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header - Responsive */}
      <div className="space-y-1 sm:space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
          Parties
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Manage customers, suppliers, and employees
        </p>
      </div>

      {/* Parties List with responsive tabs */}
      <PartyListClient parties={parties} currentType={type} />

      {/* Pagination - Centered */}
      {totalPages > 1 && (
        <div className="flex justify-center mt-4">
          <Pagination totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}
