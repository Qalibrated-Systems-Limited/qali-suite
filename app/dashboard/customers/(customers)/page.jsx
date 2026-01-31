import {
  getPartiesPaginated,
  fetchPartyPages,
} from "@/app/mongodb/queries/partyQueries";
import Pagination from "@/components/pagination";
import CustomerListClient from "../components/CustomerListClient";

export const metadata = {
  title: "Customers | ERP System",
  description: "Manage your customers",
};

export default async function CustomersPage({ searchParams }) {
  const params = await searchParams;

  const query = params?.query || "";
  const currentPage = Number(params?.page) || 1;

  const totalPages = await fetchPartyPages(query, "customer");
  const customers = await getPartiesPaginated(query, currentPage, "customer");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
        <p className="text-muted-foreground">
          {customers.length > 0
            ? `${customers.length} customer${customers.length !== 1 ? "s" : ""} found`
            : "No customers yet"}
        </p>
      </div>

      <CustomerListClient customers={customers} />

      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}
