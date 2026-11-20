import { sql } from "drizzle-orm";
import type { Tx } from "./client";
import { roleAllowed } from "@/lib/permissions";
import {
  TECHNICAL_WRITE_ROLES,
  TECHNICAL_MANAGE_ROLES,
  TECHNICAL_DEPARTMENT,
} from "@/lib/utils/role-gates";
import { permittedForKeys } from "./permissionGate";

/**
 * WHO MAY DO TECHNICAL WORK, AND WHO SIGNS IT OFF.
 *
 * Technician is a job, not a role (0039), so it is read from the person's
 * department: anyone in the Technical department carries out technical work —
 * writes reports, runs the calibration jobs and inspections assigned to them —
 * whatever their role, Employee included. The roles in TECHNICAL_WRITE_ROLES
 * may too, as they always could.
 *
 * The technical manager is the sign-off authority, TECHNICAL_MANAGE_ROLES:
 * assigns work, approves or returns results, keeps the reference standards. A
 * custom role such as "Technical Manager" acting as Manager holds it through
 * its base. Both answers honour what the company saved on the Roles &
 * Permissions page.
 */

type Actor = { id?: string | null; role?: string | null };

export interface TechnicalStanding {
  isManager: boolean;
  isTechnician: boolean;
  department: string | null;
}

async function departmentOf(tx: Tx, userId: string): Promise<string | null> {
  const [row] = (await tx.execute(sql`
    SELECT department FROM users WHERE id = ${userId}
  `)) as unknown as Array<{ department: string | null }>;
  return row?.department ?? null;
}

export async function technicalStanding(
  tx: Tx,
  user: Actor,
  companyId: string,
): Promise<TechnicalStanding> {
  const userId = String(user?.id ?? "");
  const role = String(user?.role ?? "");
  const manageRoles = TECHNICAL_MANAGE_ROLES as unknown as string[];
  const writeRoles = TECHNICAL_WRITE_ROLES as unknown as string[];

  const savedManage = await permittedForKeys(tx, userId, companyId, role, ["TECHNICAL_MANAGE_ROLES"], manageRoles);
  const isManager = savedManage ?? roleAllowed(role, manageRoles);

  const department = userId ? await departmentOf(tx, userId) : null;
  const inTechnical =
    (department ?? "").trim().toLowerCase() === TECHNICAL_DEPARTMENT.toLowerCase();

  const savedWrite = await permittedForKeys(tx, userId, companyId, role, ["TECHNICAL_WRITE_ROLES"], writeRoles);
  const isTechnician = isManager || inTechnical || (savedWrite ?? roleAllowed(role, writeRoles));

  return { isManager, isTechnician, department };
}

export class TechnicalAccessError extends Error {}

export async function requireTechnician(tx: Tx, user: Actor, companyId: string) {
  const s = await technicalStanding(tx, user, companyId);
  if (!s.isTechnician) {
    throw new TechnicalAccessError(
      "Technical work is for the Technical department. Ask an administrator to set your department to Technical.",
    );
  }
  return s;
}

export async function requireTechnicalManager(tx: Tx, user: Actor, companyId: string) {
  const s = await technicalStanding(tx, user, companyId);
  if (!s.isManager) {
    throw new TechnicalAccessError("Only a technical manager can do that.");
  }
  return s;
}

/**
 * Everyone who can be given technical work or sign it off in this company,
 * with their role resolved through any custom role to its base. A user is
 * listed when their department is Technical or their (resolved) role holds a
 * technical gate.
 */
export async function listTechnicalPeople(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT u.id, u.name, u.department,
           COALESCE(cr.base_role, COALESCE(a.role, u.role)) AS role,
           COALESCE(a.role, u.role) AS title
      FROM users u
      JOIN user_company_access a
        ON a.user_id = u.id
       AND a.status = 'active'
       AND a.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
      LEFT JOIN custom_roles cr
        ON cr.company_id = a.company_id
       AND lower(cr.name) = lower(COALESCE(a.role, u.role))
     WHERE COALESCE(u.status, 'active') NOT IN ('inactive', 'Inactive')
     ORDER BY u.name
  `)) as unknown as Array<{ id: string; name: string; department: string | null; role: string; title: string }>;

  const manage = TECHNICAL_MANAGE_ROLES as unknown as string[];
  const write = TECHNICAL_WRITE_ROLES as unknown as string[];
  return rows
    .map((r) => {
      const inTechnical =
        String(r.department ?? "").trim().toLowerCase() === TECHNICAL_DEPARTMENT.toLowerCase();
      const isManager = roleAllowed(r.role, manage);
      return {
        id: String(r.id),
        name: String(r.name),
        title: String(r.title ?? r.role),
        department: r.department ?? "",
        isManager,
        isTechnician: isManager || inTechnical || roleAllowed(r.role, write),
      };
    })
    .filter((p) => p.isTechnician);
}
