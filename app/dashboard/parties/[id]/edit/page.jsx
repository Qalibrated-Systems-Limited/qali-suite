import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPartyById } from "@/app/mongodb/queries/partyQueries";
import PartyForm from "../../components/partyForm";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Edit Party | ERP System",
};

export default async function EditPartyPage({ params }) {
  const { id } = await params;

  // Fetch party
  const party = await getPartyById(id);

  if (!party) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/dashboard/parties/${party._id}`}>
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Edit Party</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Update {party.name}'s information
          </p>
        </div>
      </div>

      {/* Form */}
      <PartyForm party={party} />
    </div>
  );
}
