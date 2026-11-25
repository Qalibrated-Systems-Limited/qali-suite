import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  ArrowLeft,
  Boxes,
  Building2,
  ShoppingBag,
  Presentation,
  Wrench,
  HandCoins,
  ReceiptText,
  Landmark,
  Users,
  CalendarDays,
  LifeBuoy,
  ChevronRight,
  ClipboardList,
} from "lucide-react";

export const metadata = { title: "New requisition" };

/**
 * Every kind of requisition in QaliSuite, in one place. Requisitions opens
 * here: pick what you need and the right form opens, already set to that
 * type. Each form keeps its own approval route.
 */
const GROUPS = [
  {
    title: "Stores and materials",
    blurb: "Items issued from the store — approved by stores and your manager.",
    items: [
      { icon: Building2, title: "Internal use", text: "Consumables, tools and items for the office or a department.", href: "/dashboard/requests/create?type=internal" },
      { icon: Wrench, title: "Project or installation materials", text: "Materials for an installation job or a project site.", href: "/dashboard/requests/create?type=installation" },
      { icon: Wrench, title: "Repair or service", text: "Parts for a repair or service job.", href: "/dashboard/requests/create?type=repair" },
      { icon: ShoppingBag, title: "Sale to a customer", text: "Items going out to a customer on a sale.", href: "/dashboard/requests/create?type=sale" },
      { icon: Boxes, title: "Borrow a tool or item", text: "Take an item out for company work and return it after.", href: "/dashboard/requests/create?type=employee_borrow" },
      { icon: Presentation, title: "Demo or customer trial", text: "Items loaned for a demonstration, returned or sold after.", href: "/dashboard/requests/create?type=demo" },
    ],
  },
  {
    title: "Money",
    blurb: "Cash before you spend it, or back after you have.",
    items: [
      { icon: HandCoins, title: "Cash advance", text: "Money up front for travel, a site visit or a purchase.", href: "/dashboard/claims/create/advance" },
      { icon: ReceiptText, title: "Expense reimbursement", text: "Claim back money you spent for work, with receipts.", href: "/dashboard/claims/create/reimbursement" },
      { icon: Landmark, title: "Project cash requisition", text: "Site cash against a project's budget and cost codes.", href: "/dashboard/projects/cash-requisitions" },
    ],
  },
  {
    title: "People and equipment",
    blurb: "Approved by the technical manager or HR.",
    items: [
      { icon: Users, title: "Technician, vehicle or test equipment", text: "Book a technician, a vehicle or equipment for a job.", href: "/dashboard/technical/resources?new=1" },
      { icon: CalendarDays, title: "Leave", text: "Annual, sick, compassionate or other leave.", href: "/dashboard/hr/leave/create" },
    ],
  },
  {
    title: "Services and support",
    blurb: "Handled by the help desk.",
    items: [
      { icon: LifeBuoy, title: "IT, facilities or other service", text: "A laptop, an account, a repair in the office — raised as a help desk ticket.", href: "/dashboard/helpdesk?new=1" },
    ],
  },
];

export default async function NewRequisitionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-1 py-2 sm:px-2">
      <div className="flex items-start gap-3">
        <Link href="/dashboard/requests" className="mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
            <ClipboardList className="h-6 w-6 text-primary" /> New requisition
          </h1>
          <p className="text-sm text-muted-foreground">What do you need? Choose one and the right form opens.</p>
        </div>
      </div>

      {GROUPS.map((g) => (
        <section key={g.title} className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold">{g.title}</h2>
            <p className="text-xs text-muted-foreground">{g.blurb}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((it) => {
              const Icon = it.icon;
              return (
                <Link
                  key={it.title}
                  href={it.href}
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-muted/30"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                      {it.title}
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{it.text}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Boxes className="h-3.5 w-3.5" /> Track what you have raised under Requisitions, My expenses &amp; advances, My Leave and Help Desk.
      </p>
    </div>
  );
}
