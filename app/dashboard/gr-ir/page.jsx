import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { can } from "@/lib/capabilities";
import {
  getGrIrSummaryPg,
  getGrIrAgeingPg,
  listGrIrPositionsPg,
  listBillsAwaitingReceiptPg,
} from "@/app/db/actions/gr-ir-actions";

/**
 * PURCHASE RECONCILIATION — GR/IR, said in business language.
 *
 * WHY THIS SCREEN EXISTS. GR/IR is the account that holds the value of goods
 * between the delivery and the invoice, and until now the only way to see what
 * was in it was to open the general ledger. That asks a procurement officer to
 * read a journal and work out that a credit balance of 20,000 means a delivery
 * nobody has billed us for. The journal tells you what the system POSTED; this
 * tells you what needs attention.
 *
 * THE SIGN IS NEVER SHOWN. It is translated, everywhere, without exception:
 *
 *     +20,000   ->  "KES 20,000 received, not invoiced"
 *     -20,000   ->  "KES 20,000 invoiced, not received"
 *      0        ->  "Matched"
 *
 * AND NEITHER SIDE IS CALLED AN ERROR. Goods received and not yet invoiced is
 * a supplier who has not sent the invoice — ordinary, until it is old. Billed
 * without a receipt is more likely to need investigating and can still be
 * legitimate when billing precedes delivery. Age is what separates the routine
 * from the wrong, which is why the ageing ladder is on the same screen and not
 * a report somebody has to go and find.
 *
 * IT RECONCILES TO THE LEDGER IN THE OPEN. The positions are built on purchase
 * order lines, and acceptance credits GR/IR for receipts raised against a bill
 * directly or with no source document. Those postings are in the account and
 * not in the positions, so the difference is printed as its own figure rather
 * than a subtotal presented as a balance. A reconciliation screen that hides
 * its own gap is worse than the journal it replaces.
 */

export const metadata = {
  title: "Purchase Reconciliation | ERP System",
  description: "GR/IR — goods received against supplier invoices",
};

const money = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(
    Math.round(Number(n) || 0),
  );

/** 4,850,000 -> "4.85M". The tiles are read at a glance, not audited. */
const compact = (n) => {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return money(v);
};

const DIRECTION = {
  awaiting_invoice: {
    label: "Awaiting invoice",
    sentence: (value) => `KES ${money(value)} received, not invoiced`,
    tone: "text-amber-600 dark:text-amber-500",
    chip: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  },
  awaiting_receipt: {
    label: "Awaiting receipt",
    sentence: (value) => `KES ${money(value)} invoiced, not received`,
    tone: "text-red-600 dark:text-red-500",
    chip: "bg-red-500/10 text-red-600 border-red-500/20",
  },
  matched: {
    label: "Matched",
    sentence: () => "Matched",
    tone: "text-emerald-600 dark:text-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  },
};

const BUCKETS = ["0-30", "31-60", "61-90", "90+", "unknown"];
const BUCKET_LABELS = {
  "0-30": "0–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "Over 90 days",
  unknown: "No date",
};

// ============================================================================
// SUMMARY
// ============================================================================

function Tile({ label, value, hint, tone, href }) {
  const body = (
    <Card className="h-full p-4 transition-colors hover:bg-accent/40 sm:p-5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? ""}`}>
        {value}
      </p>
      {hint && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

async function SummaryTiles() {
  const s = await getGrIrSummaryPg();

  return (
    <>
      {/*
        Mobile keeps two across rather than stacking four full-width cards:
        the ageing ladder below is the thing worth scrolling to, and four
        stacked tiles put it off the bottom of a phone entirely.
      */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Goods received, invoice pending"
          value={`KES ${compact(s.awaitingInvoice)}`}
          hint="Delivered and accepted. The supplier has not billed us yet."
          tone={DIRECTION.awaiting_invoice.tone}
          href="/dashboard/gr-ir?view=awaiting_invoice"
        />
        <Tile
          label="Invoice received, goods pending"
          value={`KES ${compact(s.awaitingReceipt)}`}
          hint="Billed for goods that are not recorded as received."
          tone={DIRECTION.awaiting_receipt.tone}
          href="/dashboard/gr-ir?view=awaiting_receipt"
        />
        <Tile
          label="Matched / cleared"
          value={`KES ${compact(s.matched)}`}
          hint="Received and invoiced in full. Nothing outstanding."
          tone={DIRECTION.matched.tone}
        />
        <Tile
          label="Exceptions"
          value={String(s.exceptions)}
          hint="Order lines where received and invoiced disagree."
        />
      </div>

      <ReconciliationLine summary={s} />
    </>
  );
}

/**
 * Does the screen add up to the account?
 *
 * The one figure an accountant will look for first, and the one a dashboard
 * built on a subset of the postings must not leave out.
 */
function ReconciliationLine({ summary }) {
  const off = Math.abs(summary.unattributed) >= 1;

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">Reconciliation to the ledger</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            GR/IR Clearing, against the positions above.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4 text-right sm:gap-6">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Account
            </p>
            <p className="text-sm font-semibold tabular-nums">
              {money(summary.ledgerBalance)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Explained
            </p>
            <p className="text-sm font-semibold tabular-nums">
              {money(summary.netPositions)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Unexplained
            </p>
            <p
              className={`text-sm font-semibold tabular-nums ${
                off ? "text-red-600 dark:text-red-500" : ""
              }`}
            >
              {money(summary.unattributed)}
            </p>
          </div>
        </div>
      </div>

      {off && (
        <p className="mt-3 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
          The positions below are built from purchase order lines. Goods
          receipts raised straight against a bill, or with no source document,
          post to this account and have no order line to appear under — that is
          the usual explanation for a difference here. Bills awaiting a receipt
          are listed at the foot of this page.
        </p>
      )}
    </Card>
  );
}

// ============================================================================
// AGEING
// ============================================================================

async function AgeingLadder() {
  const rows = await getGrIrAgeingPg();
  if (!rows.length) return null;

  const byDirection = ["awaiting_invoice", "awaiting_receipt"]
    .map((direction) => ({
      direction,
      buckets: BUCKETS.map((bucket) => ({
        bucket,
        row: rows.find(
          (r) => r.direction === direction && r.ageBucket === bucket,
        ),
      })).filter((b) => b.row),
    }))
    .filter((d) => d.buckets.length);

  if (!byDirection.length) return null;

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b px-4 py-3 sm:px-5">
        <p className="text-sm font-medium">Outstanding by age</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          A position at three days is procurement working normally. The same
          figure at ninety is not.
        </p>
      </div>

      <div className="divide-y">
        {byDirection.map(({ direction, buckets }) => (
          <div key={direction} className="px-4 py-3 sm:px-5">
            <p
              className={`text-xs font-medium uppercase tracking-wide ${DIRECTION[direction].tone}`}
            >
              {DIRECTION[direction].label}
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {buckets.map(({ bucket, row }) => (
                <div
                  key={bucket}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="text-muted-foreground">
                    {BUCKET_LABELS[bucket]}
                    <span className="ml-1.5 text-xs">({row.count})</span>
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${
                      bucket === "90+" || bucket === "61-90"
                        ? "text-red-600 dark:text-red-500"
                        : ""
                    }`}
                  >
                    KES {money(row.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============================================================================
// EXCEPTIONS
// ============================================================================

function ThreeWay({ label, value, flag }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="truncate text-sm font-medium tabular-nums">
        {money(value)}
        {flag && <span className="ml-1 text-xs">{flag}</span>}
      </p>
    </div>
  );
}

async function Exceptions({ view }) {
  const positions = await listGrIrPositionsPg({
    direction: view === "all" ? "all" : view,
    limit: 100,
  });

  if (!positions.length) {
    return (
      <Card className="p-6 text-center sm:p-8">
        <p className="text-sm font-medium">Nothing outstanding</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Every order line that has been received or billed agrees with the
          other side.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {positions.map((p) => {
        const d = DIRECTION[p.direction];
        return (
          <Card key={p.lineId} className="p-4 sm:p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {p.supplierName}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {p.poNumber} · line {p.lineNumber}
                  {p.description ? ` · ${p.description}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline" className={d.chip}>
                  {d.label}
                </Badge>
                {p.ageDays != null && (
                  <span
                    className={`text-xs tabular-nums ${
                      p.ageDays > 60
                        ? "text-red-600 dark:text-red-500"
                        : "text-muted-foreground"
                    }`}
                  >
                    {p.ageDays}d
                  </span>
                )}
              </div>
            </div>

            {/* The three-way match, which is what makes the difference
                actionable: "20,000 outstanding" says nothing, and "ordered
                100,000, received 100,000, billed 80,000" says which document
                to go and look at. */}
            <div className="mt-3 grid grid-cols-3 gap-3 border-t pt-3">
              <ThreeWay label="Ordered" value={p.orderedValue} />
              <ThreeWay
                label="Received"
                value={p.receivedValue}
                flag={p.direction === "awaiting_receipt" ? "⚠" : "✓"}
              />
              <ThreeWay
                label="Invoiced"
                value={p.billedValue}
                flag={p.direction === "awaiting_invoice" ? "⚠" : "✓"}
              />
            </div>

            {/* THE SENTENCE, not the sign. */}
            <p className={`mt-3 text-sm font-medium ${d.tone}`}>
              {d.sentence(p.outstanding)}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild className="h-9">
                <Link href={`/dashboard/purchase-orders/${p.purchaseOrderId}`}>
                  View order
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="h-9">
                <Link href="/dashboard/grn">Goods receipts</Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="h-9">
                <Link href="/dashboard/bills">Bills</Link>
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * The awaiting-receipt side at DOCUMENT level.
 *
 * Catches what the order-line positions cannot: a bill approved against GR/IR
 * with no purchase order behind it still debits the account and still has no
 * receipt. It reads `used_grni AND NOT inventory_moved`, which is what
 * `approveBill` and `finaliseAcceptance` write — a fact about the documents,
 * not a status somebody maintains.
 */
async function BillsAwaitingReceipt() {
  const bills = await listBillsAwaitingReceiptPg(25);
  if (!bills.length) return null;

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b px-4 py-3 sm:px-5">
        <p className="text-sm font-medium">Bills awaiting a receipt</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Approved against GR/IR, goods not yet admitted.
        </p>
      </div>
      <div className="divide-y">
        {bills.map((b) => (
          <Link
            key={b._id}
            href={`/dashboard/bills/${b._id}`}
            className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/40 sm:px-5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{b.supplier.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {b.billNumber} · {b.billDate}
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              KES {money(b.amounts.total)}
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

// ============================================================================
// PAGE
// ============================================================================

const VIEWS = [
  { value: "all", label: "All exceptions" },
  { value: "awaiting_invoice", label: "Awaiting invoice" },
  { value: "awaiting_receipt", label: "Awaiting receipt" },
];

export default async function GrIrPage({ searchParams }) {
  const params = (await searchParams) ?? {};
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "grir.view")) redirect("/dashboard");

  const view = VIEWS.some((v) => v.value === params.view)
    ? params.view
    : "all";

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <SiteHeader
        title="Purchase Reconciliation"
        description="Goods received against supplier invoices"
      />

      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <SummaryTiles />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <AgeingLadder />
      </Suspense>

      {/* Links, not a client component: three filters on a server-rendered
          page do not need JavaScript to change a query string. */}
      <div className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Button
            key={v.value}
            variant={v.value === view ? "default" : "outline"}
            size="sm"
            asChild
            className="h-9"
          >
            <Link
              href={
                v.value === "all"
                  ? "/dashboard/gr-ir"
                  : `/dashboard/gr-ir?view=${v.value}`
              }
            >
              {v.label}
            </Link>
          </Button>
        ))}
      </div>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Exceptions view={view} />
      </Suspense>

      <Suspense fallback={null}>
        <BillsAwaitingReceipt />
      </Suspense>
    </div>
  );
}
