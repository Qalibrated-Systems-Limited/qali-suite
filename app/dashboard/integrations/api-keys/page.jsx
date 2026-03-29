import Link from "next/link";
import { ChevronLeft, Plus } from "lucide-react";
import { getIntegrationKeys } from "@/app/mongodb/actions/integration-actions";
import CreateKeyForm from "./components/CreateKeyForm";
import KeyCard from "./components/KeyCard";

export const metadata = { title: "API Keys | Integrations" };

export default async function ApiKeysPage() {
  const keys = await getIntegrationKeys();

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/integrations" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Integrations
        </Link>
        <span>/</span>
        <span className="text-foreground">API Keys</span>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">API Keys</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Issue keys to external systems — weighbridges, collection apps, logistics software.
          Each key is shown only once at creation.
        </p>
      </div>

      {/* Create form */}
      <CreateKeyForm />

      {/* Key list */}
      {keys.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <Plus className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No API keys yet. Create your first key above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {keys.length} Key{keys.length !== 1 ? "s" : ""}
          </h2>
          {keys.map((key) => (
            <KeyCard key={key._id} apiKey={key} />
          ))}
        </div>
      )}
    </div>
  );
}
