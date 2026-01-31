import {
  getPartiesPaginated,
  fetchPartyPages,
} from "@/app/mongodb/queries/partyQueries";
import Pagination from "@/components/pagination";
import SupplierListClient from "../components/SupplierListClient";

export const metadata = {
  title: "Suppliers | ERP System",
  description: "Manage your suppliers",
};

export default async function SuppliersPage({ searchParams }) {
  const params = await searchParams;

  const query = params?.query || "";
  const currentPage = Number(params?.page) || 1;

  const totalPages = await fetchPartyPages(query, "supplier");
  const suppliers = await getPartiesPaginated(query, currentPage, "supplier");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
        <p className="text-muted-foreground">
          {suppliers.length > 0
            ? `${suppliers.length} supplier${suppliers.length !== 1 ? "s" : ""} found`
            : "No suppliers yet"}
        </p>
      </div>

      <SupplierListClient suppliers={suppliers} />

      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}
