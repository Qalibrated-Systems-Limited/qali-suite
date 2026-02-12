import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { getJournalEntryById } from "@/app/mongodb/queries/journalQueries";
import { serializeBsonType } from "@/lib/utils";
import { JournalEntryDetail } from "./JournalEntryDetail";
import JournalDetailLoading from "./loading";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return {
    title: `Journal Entry ${id} | ERP System`,
    description: "View journal entry details",
  };
}

export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { id } = await params;

  const entry = await getJournalEntryById(id);

  if (!entry) {
    notFound();
  }

  const serializedEntry = serializeBsonType(entry);

  return (
    <Suspense fallback={<JournalDetailLoading />}>
      <JournalEntryDetail entry={serializedEntry} />
    </Suspense>
  );
}
