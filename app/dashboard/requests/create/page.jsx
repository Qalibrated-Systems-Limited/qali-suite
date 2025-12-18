import { auth } from "@/auth";
import { redirect } from "next/navigation";

import Product from "@/app/models/product";

import { createStockRequest } from "@/app/mongodb/requests-actions";
import { IconArrowLeft, IconClipboardList } from "@tabler/icons-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CreateStockRequestForm } from "../components/CreateRequestForm";
import dbConnect from "@/app/config/dbConnect";

export const metadata = {
  title: "Create Stock Request",
  description: "Create a new stock request",
};

async function getProducts() {
  await dbConnect();

  const products = await Product.find({})
    .select("_id name SKU stock unit price category")
    .sort({ name: 1 })
    .lean();

  return JSON.parse(JSON.stringify(products));
}

export default async function CreateRequestPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const products = await getProducts();

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
        user={session.user}
        createRequestAction={createStockRequest}
      />
    </div>
  );
}
