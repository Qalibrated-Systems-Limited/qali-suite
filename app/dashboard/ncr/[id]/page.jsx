import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { auth } from "@/auth";
import { getNCRById } from "@/app/mongodb/queries/ncr-queries";
import NCRStatusBadge, {
  NCRCategoryLabel,
  DispositionLabel,
} from "../components/NCRStatusBadge";
import NCRActions from "../components/NCRActions";

export const metadata = { title: "Nonconformance" };

function fmt(iso) {
  return iso ? format(new Date(iso), "dd MMM yyyy, HH:mm") : "—";
}

function SeverityPill({ severity }) {
  const map = {
    minor: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    major: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    critical: "bg-red-500/15 text-red-700 dark:text-red-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
        map[severity] || map.minor
      }`}
    >
      {severity}
    </span>
  );
}

export default async function NCRDetailPage({ params }) {
  const { id } = await params;
  const ncr = await getNCRById(id);
  if (!ncr) notFound();

  const session = await auth();
  const currentUser = session?.user || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/dashboard/ncr">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight font-mono">
              {ncr.ncrNumber}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mt-1">
              <NCRStatusBadge status={ncr.status} />
              <span>•</span>
              <NCRCategoryLabel category={ncr.category} />
              <span>•</span>
              <span>Raised {fmt(ncr.createdAt)}</span>
            </div>
          </div>
        </div>
        <NCRActions ncr={ncr} currentUser={currentUser} />
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-4 space-y-2 text-sm">
          <h2 className="text-base font-semibold">{ncr.title}</h2>
          <p className="text-muted-foreground whitespace-pre-line">{ncr.description}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-1.5 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wide">Source</span>
            </div>
            <p className="font-medium capitalize">
              {ncr.source.type.replace("_", " ")}
              {ncr.source.reference ? ` — ${ncr.source.reference}` : ""}
            </p>
            {ncr.source.grnId && (
              <Link
                href={`/dashboard/grn/${ncr.source.grnId}`}
                className="text-xs text-blue-600 hover:underline"
              >
                Open GRN →
              </Link>
            )}
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-1.5 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Building2 className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wide">Supplier</span>
            </div>
            <p className="font-medium">{ncr.supplier?.name || "—"}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-1.5 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wide">
                Estimated impact
              </span>
            </div>
            <p className="font-medium tabular-nums">
              {ncr.estimatedImpact > 0
                ? new Intl.NumberFormat("en-KE", {
                    style: "currency",
                    currency: "KES",
                    minimumFractionDigits: 0,
                  }).format(ncr.estimatedImpact)
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {ncr.lines.length > 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ncr.lines.map((l) => (
                  <TableRow key={l._id}>
                    <TableCell>
                      <div className="font-medium">{l.description}</div>
                      {l.sku && (
                        <div className="text-xs text-muted-foreground font-mono">
                          {l.sku}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.expectedQty} {l.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.actualQty} {l.unit}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        l.variance < 0
                          ? "text-red-600 dark:text-red-400"
                          : l.variance > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : ""
                      }`}
                    >
                      {l.variance > 0 ? "+" : ""}
                      {l.variance} {l.unit}
                    </TableCell>
                    <TableCell>
                      <SeverityPill severity={l.severity} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[300px]">
                      {l.notes}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="bg-card border-border">
        <CardContent className="p-4 space-y-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Disposition
          </p>
          <div className="flex items-center justify-between">
            <span className="font-medium">
              <DispositionLabel type={ncr.disposition.type} />
            </span>
            {ncr.status === "closed" && (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" /> Closed
              </span>
            )}
          </div>
          {ncr.disposition.reason && (
            <p className="text-xs text-muted-foreground italic">
              “{ncr.disposition.reason}”
            </p>
          )}
          {ncr.disposition.proposedBy && (
            <p className="text-xs">
              Proposed by{" "}
              <strong>{ncr.disposition.proposedBy.name}</strong> on{" "}
              {fmt(ncr.disposition.proposedBy.at)}
            </p>
          )}
          {ncr.disposition.authorizedBy && (
            <p className="text-xs">
              Authorized by{" "}
              <strong>{ncr.disposition.authorizedBy.name}</strong> on{" "}
              {fmt(ncr.disposition.authorizedBy.at)}
              {ncr.disposition.authorizedBy.notes && (
                <span className="block italic text-muted-foreground mt-0.5">
                  “{ncr.disposition.authorizedBy.notes}”
                </span>
              )}
            </p>
          )}
          {ncr.disposition.executedAt && (
            <p className="text-xs">
              Executed{" "}
              <strong>{ncr.disposition.executedBy?.name || ""}</strong> on{" "}
              {fmt(ncr.disposition.executedAt)}
              {ncr.disposition.executionNotes && (
                <span className="block italic text-muted-foreground mt-0.5">
                  “{ncr.disposition.executionNotes}”
                </span>
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
