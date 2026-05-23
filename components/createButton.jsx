"use client";

import { usePathname } from "next/navigation";
import { Button } from "./ui/button";
import { Plus, ArrowLeft } from "lucide-react";
import Link from "next/link";

export function CreateButton({ title = "New", role }) {
  let url;
  const pathname = usePathname();
  const shouldCreateRequest = [
    "/dashboard/requests",
    "/dashboard/checkout",
    "/dashboard/movement",
    "/dashboard",
  ].includes(pathname);

  return (
    <Button
      asChild
      className="bg-yellow-500 text-black hover:bg-yellow-600 font-medium"
    >
      <Link
        href={
          shouldCreateRequest
            ? "/dashboard/requests/create"
            : `${pathname}/create`
        }
      >
        <Plus className="w-4 h-4 mr-2" />
        {shouldCreateRequest ? "New Request" : title}
      </Link>
    </Button>
  );
}

export default function GoBackButton() {
  return (
    <Button
      variant="outline"
      className="border-border text-foreground hover:bg-accent"
      onClick={() => window.history.back()}
    >
      <ArrowLeft className="mr-2 h-4 w-4" />
      Go Back
    </Button>
  );
}
