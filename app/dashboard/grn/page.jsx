import Link from "next/link";
import { format } from "date-fns";
import { Plus, ClipboardCheck, AlertTriangle, Clock } from "lucide-react";
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
import GRNStatusBadge from "./components/GRNStatusBadge";
import { getGRNs, getGRNStats } from "@/app/mongodb/queries/grn-queries";

export const metadata = { title: "Goods Receipt Notes" };

function fmt(iso) {
  return iso ? format(new Date(iso), "dd MMM yyyy") : "—";
}

async function GRNListSection({ searchParams }) {
  const params = await searchParams;
  const status = params?.status || "";
  const search = params?.search || "";
  const page = Number(params?.page) || 1;
  const { grns, pagination } = await getGRNs({ page, status, search });

  if (grns.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-16 text-center text-muted-foreground">
          <ClipboardCheck className="mx-auto h-10 w-10 mb-3 opacity-40" />
          <p>No goods receipt notes yet.</p>
          <p className="text-xs mt-1">
            Create one from an approved bill, or as an unscheduled receipt.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>GRN #</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grns.map((g) => {
              const lineCount = g.lines.length;
              const issueCount = g.lines.filter(
                (l) =>
                  l.packagingCondition !== "good" ||
                  l.physicalCondition !== "good" ||
                  l.receivedQty !== l.expectedQty,
              ).length;
              return (
                <TableRow key={g._id}>
                  <TableCell className="font-mono text-xs">
                    {g.grnNumber}
                  </TableCell>
                  <TableCell className="text-sm">
                    {fmt(g.receivedDate)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {g.supplier?.name || "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground capitalize">
                    {g.source.type.replace("_", " ")}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {lineCount}
                    {issueCount > 0 && (
                      <span
                        className="ml-2 inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
                        title={`${issueCount} line(s) have a discrepancy`}
                      >
                        <AlertTriangle className="h-3 w-3" /> {issueCount}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <GRNStatusBadge status={g.status} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/dashboard/grn/${g._id}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>
              Page {pagination.page} of {pagination.totalPages} ·{" "}
              {pagination.total} GRNs
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

async function StatsRow() {
  const stats = await getGRNStats();
  const cards = [
    {
      label: "Pending acceptance",
      value: stats.pending_acceptance,
      icon: Clock,
      tone: "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Accepted",
      value: stats.accepted + stats.partially_accepted,
      icon: ClipboardCheck,
      tone: "text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "Rejected",
      value: stats.rejected,
      icon: AlertTriangle,
      tone: "text-red-600 dark:text-red-400",
    },
    {
      label: "Total GRNs",
      value: stats.total,
      icon: ClipboardCheck,
      tone: "text-blue-600 dark:text-blue-400",
    },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <Card key={c.label} className="bg-card border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-2xl font-bold mt-1">{c.value}</p>
            </div>
            <c.icon className={`h-7 w-7 ${c.tone}`} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default async function GRNIndexPage(props) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Goods Receipt Notes
          </h1>
          <p className="text-sm text-muted-foreground">
            Receive, inspect, and admit incoming stock
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/grn/create">
            <Plus className="h-4 w-4 mr-1.5" />
            New GRN
          </Link>
        </Button>
      </div>

      {/* @ts-expect-error Async Server Component */}
      <StatsRow />
      {/* @ts-expect-error Async Server Component */}
      <GRNListSection searchParams={props.searchParams} />
    </div>
  );
}
