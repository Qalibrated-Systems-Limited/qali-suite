import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  ClipboardCheck,
  AlertTriangle,
  CheckCircle2,
  Building2,
  FileText,
  Download,
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
import { getGRNById } from "@/app/mongodb/queries/grn-queries";
import GRNStatusBadge from "../components/GRNStatusBadge";
import GRNActions from "../components/GRNActions";

export const metadata = { title: "Goods Receipt Note" };

function fmt(iso) {
  return iso ? format(new Date(iso), "dd MMM yyyy, HH:mm") : "—";
}

function ConditionPill({ value, type }) {
  // type = "packaging" | "physical"
  const isGood = value === "good";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
        isGood
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      }`}
      title={`${type} condition`}
    >
      {value}
    </span>
  );
}

function LineStatusPill({ status }) {
  const map = {
    pending: "bg-muted text-muted-foreground",
    hold: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    accepted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    rejected: "bg-red-500/15 text-red-700 dark:text-red-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
        map[status] || map.pending
      }`}
    >
      {status}
    </span>
  );
}

export default async function GRNDetailPage({ params }) {
  const { id } = await params;
  const grn = await getGRNById(id);
  if (!grn) notFound();

  const session = await auth();
  const currentUser = session?.user || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/dashboard/grn">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight font-mono">
              {grn.grnNumber}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mt-1">
              <GRNStatusBadge status={grn.status} />
              <span>•</span>
              <span>Received {fmt(grn.receivedDate)}</span>
              {grn.hasDiscrepancy && (
                <>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> Discrepancy
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            {/* Route returns Content-Disposition: attachment, so this
                triggers a real download rather than a new-tab preview.
                The `download` attribute is a redundant hint for browsers
                that don't honour the server header (rare). */}
            <a
              href={`/api/grn/${grn._id}/pdf`}
              download={`${grn.grnNumber}.pdf`}
              className="gap-1.5"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </a>
          </Button>
          <GRNActions grn={grn} currentUser={currentUser} />
        </div>
      </div>

      {/* Summary card */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Building2 className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wide">Supplier</span>
            </div>
            <p className="font-medium">{grn.supplier?.name || "—"}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wide">Source</span>
            </div>
            <p className="font-medium capitalize">
              {grn.source.type.replace("_", " ")}
            </p>
            {grn.source.billId && (
              <Link
                href={`/dashboard/bills/${grn.source.billId}`}
                className="text-xs text-blue-600 hover:underline"
              >
                View bill →
              </Link>
            )}
            {grn.source.proformaInvoiceNumber && (
              <p className="text-xs text-muted-foreground">
                PI: {grn.source.proformaInvoiceNumber}
              </p>
            )}
            {grn.source.packingListNumber && (
              <p className="text-xs text-muted-foreground">
                Packing list: {grn.source.packingListNumber}
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <ClipboardCheck className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wide">
                Received by
              </span>
            </div>
            <p className="font-medium">{grn.receivedBy?.name || "—"}</p>
          </CardContent>
        </Card>
      </div>

      {/* Sales / Finance acceptance */}
      <div className="grid gap-4 sm:grid-cols-2">
        <SignoffCard
          label="Sales acceptance — inspection sign-off"
          stamp={grn.salesAccepted}
        />
        <SignoffCard
          label="Finance acceptance — inspection sign-off"
          stamp={grn.financeAccepted}
        />
      </div>

      {/* Lines table */}
      <Card className="bg-card border-border">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Accepted</TableHead>
                <TableHead>Packaging</TableHead>
                <TableHead>Physical</TableHead>
                <TableHead>Storage</TableHead>
                <TableHead>Line status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grn.lines.map((l) => {
                const variance = l.receivedQty - l.expectedQty;
                return (
                  <TableRow key={l._id}>
                    <TableCell>
                      <div className="font-medium">{l.description}</div>
                      {l.sku && (
                        <div className="text-xs text-muted-foreground font-mono">
                          {l.sku}
                        </div>
                      )}
                      {l.inspectionNotes && (
                        <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                          “{l.inspectionNotes}”
                        </div>
                      )}
                      {l.rejectReason && (
                        <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                          Rejected: {l.rejectReason}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.expectedQty} {l.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.receivedQty} {l.unit}
                      {variance !== 0 && (
                        <span
                          className={`ml-1 text-xs ${
                            variance < 0
                              ? "text-red-600 dark:text-red-400"
                              : "text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          ({variance > 0 ? "+" : ""}
                          {variance})
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.lineStatus === "accepted" || l.lineStatus === "rejected"
                        ? `${l.acceptedQty} ${l.unit}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <ConditionPill value={l.packagingCondition} type="packaging" />
                    </TableCell>
                    <TableCell>
                      <ConditionPill value={l.physicalCondition} type="physical" />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.storageLocation || "—"}
                    </TableCell>
                    <TableCell>
                      <LineStatusPill status={l.lineStatus} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Notes / discrepancy summary */}
      {(grn.notes || grn.discrepancyNotes || grn.rejectReason) && (
        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-3 text-sm">
            {grn.notes && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Notes
                </p>
                <p className="whitespace-pre-line">{grn.notes}</p>
              </div>
            )}
            {grn.discrepancyNotes && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Discrepancy summary
                </p>
                <p className="whitespace-pre-line">{grn.discrepancyNotes}</p>
              </div>
            )}
            {grn.rejectReason && grn.status === "rejected" && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Reject reason
                </p>
                <p className="whitespace-pre-line text-red-600 dark:text-red-400">
                  {grn.rejectReason}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SignoffCard({ label, stamp }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4 space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {stamp ? (
          <>
            <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              {stamp.name}
            </div>
            <p className="text-xs text-muted-foreground">
              {format(new Date(stamp.at), "dd MMM yyyy, HH:mm")}
            </p>
            {stamp.notes && (
              <p className="text-xs text-muted-foreground italic">
                “{stamp.notes}”
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground italic">Awaiting</p>
        )}
      </CardContent>
    </Card>
  );
}
