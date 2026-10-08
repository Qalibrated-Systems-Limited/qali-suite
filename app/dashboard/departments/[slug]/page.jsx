import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { DEPARTMENTS } from "@/components/departments-config";
import DepartmentWorkspace from "@/components/department-workspace";
import { getDepartmentKpis } from "@/app/db/actions/department-kpi-actions";

/**
 * A department's landing dashboard. The ERP is divided into departments for
 * navigation (see components/sidebar-content-grouped.jsx `DEPARTMENTS`); each
 * one's heading links here, and this lists the modules that department owns —
 * gated exactly as the sidebar gates them, because it reads the same config.
 */
export async function generateMetadata({ params }) {
  const { slug } = await params;
  const dept = DEPARTMENTS.find((d) => d.slug === slug);
  return { title: dept ? `${dept.label} | Departments` : "Departments" };
}

export default async function DepartmentPage({ params }) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const dept = DEPARTMENTS.find((d) => d.slug === slug);
  if (!dept) notFound();

  // Live figures, fetched server-side and passed in. getDepartmentKpis never
  // throws — a department with no live figures just gets an empty row.
  const kpis = await getDepartmentKpis(slug);

  return <DepartmentWorkspace user={session.user} slug={slug} kpis={kpis} />;
}
