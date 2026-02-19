import { auth } from "@/auth";
import { redirect } from "next/navigation";

import Product from "@/app/models/product";
import Party from "@/app/models/parties";

import { createStockRequest } from "@/app/mongodb/requests-actions";
import { IconArrowLeft, IconClipboardList } from "@tabler/icons-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CreateStockRequestForm } from "../components/CreateRequestForm";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { getActiveProjects } from "@/app/mongodb/queries/projectQueries";

export const metadata = {
  title: "Create Stock Request",
  description: "Create a new stock request",
};

async function getProducts(companyId) {
  await dbConnect();

  const filter = companyId ? { companyId } : {};
  const products = await Product.find(filter)
    .select("_id name SKU inventory.quantityAvailable inventory.quantityOnHand stock unit pricing.sellingPrice price category")
    .sort({ name: 1 })
    .lean();

  return JSON.parse(JSON.stringify(products));
}

async function getCustomers(companyId) {
  await dbConnect();

  const filter = {
    type: { $in: ["customer", "both"] },
    isActive: true,
  };
  if (companyId) {
    filter.companyId = companyId;
  }

  const customers = await Party.find(filter)
    .select("_id name email phone address taxPin")
    .sort({ name: 1 })
    .lean();

  return JSON.parse(JSON.stringify(customers));
}

export default async function CreateRequestPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Get tenant context
  const { companyId } = await getTenantContext();

  // Fetch products and customers in parallel
  const [products, customers, projects] = await Promise.all([
    getProducts(companyId),
    getCustomers(companyId),
    getActiveProjects(),
  ]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/requests">
              <IconArrowLeft className="w-4 h-4 mr-2" />
              Back to Requests
            </Link>
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-yellow-500/10 flex items-center justify-center">
            <IconClipboardList className="h-6 w-6 text-yellow-500" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Create Stock Request
            </h1>
            <p className="text-muted-foreground">
              Request items from the warehouse for your department
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <CreateStockRequestForm
        products={products}
        customers={customers}
        projects={projects}
        user={session.user}
        createRequestAction={createStockRequest}
      />
    </div>
  );
}
