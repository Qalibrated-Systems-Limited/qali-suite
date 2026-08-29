import { auth } from "@/auth";
import { redirect } from "next/navigation";

import {
  createStockRequest,
  getRequestFormData,
} from "@/app/db/actions/request-actions";
import { IconArrowLeft, IconClipboardList } from "@tabler/icons-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CreateStockRequestForm } from "../components/CreateRequestForm";
import { getActiveProjects, getAllCostCodes } from "@/app/db/actions/project-actions";

export const metadata = {
  title: "Create Stock Request",
  description: "Create a new stock request",
};



export default async function CreateRequestPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Customers and products come from the store the form writes to, and no
  // companyId is passed: RLS supplies it. Projects are still a Mongo module.
  const [{ products, customers }, projects, costCodes] = await Promise.all([
    getRequestFormData(),
    getActiveProjects(),
    getAllCostCodes(),
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
            <h1 className="text-xl sm:text-2xl font-semibold text-foreground">
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
        costCodes={costCodes}
        products={products}
        customers={customers}
        projects={projects}
        user={session.user}
        createRequestAction={createStockRequest}
      />
    </div>
  );
}
