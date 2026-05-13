import Link from "next/link";
import { format } from "date-fns";
import {
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import NCRStatusBadge, { NCRCategoryLabel } from "./components/NCRStatusBadge";
import { getNCRs, getNCRStats } from "@/app/mongodb/queries/ncr-queries";

export const metadata = { title: "Nonconformance Register" };

function fmt(iso) {
  return iso ? format(new Date(iso), "dd MMM yyyy") : "—";
}

async function StatsRow() {
  const s = await getNCRStats();
  const cards = [
    { label: "Open", value: s.open, icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-400" },
    { label: "Awaiting authorization", value: s.disposition_proposed, icon: ShieldAlert, tone: "text-blue-600 dark:text-blue-400" },
    { label: "Authorized", value: s.authorized, icon: Clock, tone: "text-purple-600 dark:text-purple-400" },
    { label: "Closed", value: s.closed, icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" },
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

async function NCRList({ searchParams }) {
  const params = await searchParams;
  const status = params?.status || "";
  const category = params?.category || "";
  const search = params?.search || "";
  const page = Number(params?.page) || 1;
  const { ncrs, pagination } = await getNCRs({ page, status, category, search });

  if (ncrs.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-16 text-center text-muted-foreground">
          <ShieldAlert className="mx-auto h-10 w-10 mb-3 opacity-40" />
          <p>No nonconformances logged.</p>
          <p className="text-xs mt-1">
            Discrepancies on Goods Receipt Notes appear here automatically.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>NCR #</TableHead>
              <TableHead>Raised</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ncrs.map((n) => (
              <TableRow key={n._id}>
                <TableCell className="font-mono text-xs">{n.ncrNumber}</TableCell>
                <TableCell className="text-sm">{fmt(n.createdAt)}</TableCell>
                <TableCell className="text-sm max-w-[260px] truncate">{n.title}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {n.source.reference || n.source.type?.replace("_", " ")}
                </TableCell>
                <TableCell className="text-sm">{n.supplier?.name || "—"}</TableCell>
                <TableCell><NCRCategoryLabel category={n.category} /></TableCell>
                <TableCell><NCRStatusBadge status={n.status} /></TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/dashboard/ncr/${n._id}`}>Open</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} NCRs
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function NCRIndexPage(props) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Nonconformance Register</h1>
        <p className="text-sm text-muted-foreground">
          Track and resolve quality and quantity issues across receipts, stock counts, and tool returns
        </p>
      </div>

      {/* @ts-expect-error Async Server Component */}
      <StatsRow />
      {/* @ts-expect-error Async Server Component */}
      <NCRList searchParams={props.searchParams} />
    </div>
  );
}
