"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withAuthorizedTenant } from "../tenant";
import { HR_WRITE_ROLES, HR_ADMIN_ROLES } from "@/lib/utils/role-gates";
import { userMessage } from "../errors";
import * as departments from "../repositories/departments";

/**
 * Postgres-backed department actions.
 *
 * Thin, per docs/POSTGRES-MIGRATION-PLAN.md §4.1: authorise, open a scoped
 * transaction, delegate. The rules are in the repository and the schema.
 *
 * Errors come back through `userMessage`, so a constraint the database
 * refuses arrives as the sentence written at the constraint rather than as the
 * statement drizzle wraps it in.
 */

export type ActionResult =
  | { success: true; id?: string; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const orNull = (fd: FormData, key: string) => str(fd, key) || null;

export async function createDepartment(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const name = str(formData, "name");
  if (!name) {
    return {
      success: false,
      error: "Department name is required",
      fieldErrors: { name: "Required" },
    };
  }

  let id: string;
  try {
    const created = await withAuthorizedTenant(
      [...HR_WRITE_ROLES],
      (tx, { user, companyId }) =>
        departments.createDepartment(tx, {
          companyId,
          name,
          description: orNull(formData, "description"),
          parentDepartmentId: orNull(formData, "parentDepartmentId"),
          costCenterAccountId: orNull(formData, "costCenterAccountId"),
          actor: { id: user.id, name: user.name },
        }),
    );
    id = created.id;
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not create the department.") };
  }

  revalidatePath("/dashboard/hr/departments");
  redirect(`/dashboard/hr/departments/${id}`);
}

/**
 * Create-on-the-fly from a picker. Returns the row instead of redirecting, so
 * the form the user is filling in stays where it is.
 */
export async function createDepartmentQuick(name: string) {
  try {
    const created = await withAuthorizedTenant(
      [...HR_WRITE_ROLES],
      (tx, { user, companyId }) =>
        departments.createDepartment(tx, {
          companyId,
          name,
          actor: { id: user.id, name: user.name },
        }),
    );
    revalidatePath("/dashboard/hr/departments");
    return {
      success: true as const,
      department: { id: created.id, name: created.name, code: created.code },
    };
  } catch (err) {
    return { success: false as const, error: userMessage(err, "Could not create the department.") };
  }
}

export async function updateDepartment(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = str(formData, "deptId");
  if (!id) return { success: false, error: "Department ID is required" };

  const name = str(formData, "name");
  if (!name) {
    return {
      success: false,
      error: "Department name is required",
      fieldErrors: { name: "Required" },
    };
  }

  try {
    await withAuthorizedTenant([...HR_WRITE_ROLES], (tx, { user }) =>
      departments.updateDepartment(tx, {
        id,
        name,
        description: orNull(formData, "description"),
        parentDepartmentId: orNull(formData, "parentDepartmentId"),
        costCenterAccountId: orNull(formData, "costCenterAccountId"),
        headEmployeeId: orNull(formData, "headEmployeeId"),
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not update the department.") };
  }

  revalidatePath("/dashboard/hr/departments");
  revalidatePath(`/dashboard/hr/departments/${id}`);
  redirect(`/dashboard/hr/departments/${id}`);
}

/**
 * Activate or deactivate.
 *
 * Says how many people are still filed under it, because deactivating hides it
 * from every picker — including the one on their own edit form, where the
 * department they are in can then no longer be re-selected.
 */
export async function setDepartmentActive(id: string, isActive: boolean) {
  try {
    const { staffAffected } = await withAuthorizedTenant(
      [...HR_ADMIN_ROLES],
      (tx, { user }) =>
        departments.setDepartmentActive(tx, id, isActive, {
          id: user.id,
          name: user.name,
        }),
    );

    revalidatePath("/dashboard/hr/departments");
    revalidatePath(`/dashboard/hr/departments/${id}`);

    if (!isActive && staffAffected > 0) {
      return {
        success: true as const,
        message: `Deactivated. ${staffAffected} employee${staffAffected === 1 ? "" : "s"} ${staffAffected === 1 ? "is" : "are"} still assigned to it — move them to keep the org chart accurate.`,
      };
    }
    return { success: true as const };
  } catch (err) {
    return { success: false as const, error: userMessage(err, "Could not change the department.") };
  }
}

export async function deleteDepartment(id: string) {
  try {
    await withAuthorizedTenant([...HR_ADMIN_ROLES], (tx) =>
      departments.deleteDepartment(tx, id),
    );
  } catch (err) {
    return { success: false as const, error: userMessage(err, "Could not delete the department.") };
  }
  revalidatePath("/dashboard/hr/departments");
  return { success: true as const };
}

// ── Reads ────────────────────────────────────────────────────────────────────
// Pages call these directly. They authorise the same way the writes do, so a
// page cannot read what an action would refuse to change.

export async function listDepartmentsForPage(opts: {
  search?: string;
  isActive?: string;
  page?: number;
  limit?: number;
} = {}) {
  const limit = opts.limit ?? 50;
  const page = Math.max(opts.page ?? 1, 1);

  return withAuthorizedTenant([...HR_WRITE_ROLES], async (tx) => {
    const { rows, total } = await departments.listDepartments(tx, {
      search: opts.search,
      isActive:
        opts.isActive === "true" ? true : opts.isActive === "false" ? false : null,
      limit,
      offset: (page - 1) * limit,
    });
    return {
      departments: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  });
}

export async function getDepartmentForPage(id: string) {
  return withAuthorizedTenant([...HR_WRITE_ROLES], (tx) =>
    departments.getDepartment(tx, id),
  );
}

/** The picker shape: active departments only. */
export async function listActiveDepartments() {
  return withAuthorizedTenant([], (tx) => departments.listActiveDepartments(tx));
}
