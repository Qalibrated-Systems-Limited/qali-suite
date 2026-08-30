import {
  getProjectTransactions,
  getProjectFinancialSummary,
} from "@/app/db/actions/project-actions";
import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";
import { Info, Receipt as ReceiptIcon } from "lucide-react";

export const metadata = {
  title: "IPC & Payments | Projects",
  description: "Billing certified and invoiced against a project's contract",
};

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function DocList({ title, items, hrefBase, numberKey, partyKey, amountFn }) {
  if (!items?.length) return null;
  return (
    <div className="mb-6 last:mb-0">
      <h3 className="text-sm font-medium text-muted-foreground mb-2">
        {title} ({items.length})
      </h3>
      <div className="space-y-2">
        {items.map((doc) => (
          <Link
            key={doc._id}
            href={`${hrefBase}/${doc._id}`}
            className="flex items-start justify-between gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-muted-foreground">{doc[numberKey]}</span>
                <Badge variant="secondary" className="text-xs">{doc.status}</Badge>
              </div>
              <p className="text-sm font-medium mt-0.5 truncate">{doc[partyKey]?.name || "—"}</p>
            </div>
            <p className="text-sm font-semibold shrink-0">KES {formatCurrency(amountFn(doc))}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function IpcPaymentsPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp);
  if (ctx.denied) return <AccessDenied />;

  const { projects, project } = ctx;

  if (!project) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <WorkspaceHeader
          title="IPC & Payments"
          description="Billing certified and invoiced against a project's contract."
          project={null}
          projects={projects}
        />
        <NoProjectsCard />
      </div>
    );
  }

  const [transactions, financials] = await Promise.all([
    getProjectTransactions(project.id),
    getProjectFinancialSummary(project.id),
  ]);

  const invoices = transactions?.invoices || [];
  const bills = transactions?.bills || [];
  const contractValue = project.contractValue ? Number(project.contractValue) : 0;
  const invoiced = financials?.revenue || 0;
  const certifiedPct = contractValue > 0 ? Math.round((invoiced / contractValue) * 100) : null;

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <WorkspaceHeader
        title="IPC & Payments"
        description="Billing certified and invoiced against a project's contract."
        project={project}
        projects={projects}
      />

      <Alert className="border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm">
          Formal Interim Payment Certificates aren&apos;t a separate module
          yet — this shows what has actually been invoiced and billed
          against the project so far, from the Sales and Purchases modules.
        </AlertDescription>
      </Alert>

      {/* Contract summary */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-lg p-2.5 bg-primary/10">
            <ReceiptIcon className="h-5 w-5 text-primary" />
          </div>
          <h2 className="font-semibold text-lg">Contract billing summary</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
          {contractValue > 0 && (
            <div>
              <p className="text-xs text-muted-foreground">Contract value</p>
              <p className="text-lg font-bold">KES {formatCurrency(contractValue)}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground">Invoiced to date</p>
            <p className="text-lg font-bold text-emerald-600">KES {formatCurrency(invoiced)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Billed by suppliers</p>
            <p className="text-lg font-bold text-red-600">
              KES {formatCurrency(financials?.costs || 0)}
            </p>
          </div>
        </div>
        {certifiedPct !== null && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Contract invoiced</span>
              <span className="font-medium">{certifiedPct}%</span>
            </div>
            <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-yellow-500"
                style={{ width: `${Math.min(certifiedPct, 100)}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* Linked documents */}
      <Card className="p-5 sm:p-6">
        <h2 className="font-semibold text-lg mb-4">Linked billing documents</h2>
        {invoices.length === 0 && bills.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No invoices or supplier bills linked to this project yet.
          </p>
        ) : (
          <>
            <DocList
              title="Client Invoices"
              items={invoices}
              hrefBase="/dashboard/invoices"
              numberKey="invoiceNumber"
              partyKey="customer"
              amountFn={(d) => d.total}
            />
            <DocList
              title="Supplier Bills"
              items={bills}
              hrefBase="/dashboard/bills"
              numberKey="billNumber"
              partyKey="vendor"
              amountFn={(d) => d.amounts?.netPayable ?? d.amounts?.total}
            />
          </>
        )}
      </Card>
    </div>
  );
}
