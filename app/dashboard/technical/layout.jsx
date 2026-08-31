import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PlanGate } from "@/components/plan-gate-boundary";
import TechnicalNav from "./components/TechnicalNav";
import "./technical.css";

/**
 * Technical — the QSL field-service reporting app, brought into the ERP as a
 * Projects-module feature. The whole module wears the QSL "Qalibrated Systems"
 * skin (the coal/gold striped bar, gold actions, angular status cards) while
 * reading the ERP's own light / dark(-blue) theme tokens, so it flips with the
 * ERP toggle. Gated on the existing `projects` plan module.
 */
export default async function TechnicalLayout({ children }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <PlanGate module="projects" feature="Technical">
      <div className="tech">
        <div className="tech-stripe" />
        <Suspense fallback={<div className="tech-nav" style={{ height: 44 }} />}>
          <TechnicalNav />
        </Suspense>
        <main>{children}</main>
      </div>
    </PlanGate>
  );
}
