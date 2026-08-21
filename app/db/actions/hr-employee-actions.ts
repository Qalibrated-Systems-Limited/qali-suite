"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withAuthorizedTenant } from "../tenant";
import {
  HR_WRITE_ROLES,
  HR_ADMIN_ROLES,
  HR_COMPENSATION_ROLES,
} from "@/lib/utils/role-gates";
import { userMessage } from "../errors";
import * as employees from "../repositories/employees";
import * as departments from "../repositories/departments";
import { deactivateUser } from "../userAdmin";
import cloudinary from "@/lib/cloudinary";

/**
 * Postgres-backed employee actions.
 *
 * Thin, per docs/POSTGRES-MIGRATION-PLAN.md §4.1. Two things happen here that
 * cannot happen in a repository, and only those two:
 *
 *   - CLOUDINARY. Uploading and deleting an asset is a call to somebody else's
 *     service, so it cannot be inside the database transaction. The order is
 *     deliberate: upload first and record second, so a failed upload writes
 *     nothing; delete the record first and the asset second, so a failed
 *     delete leaves an orphan in storage rather than a row pointing at
 *     nothing.
 *
 *   - THE LOGIN. `users` is a platform table outside this tenant's RLS scope
 *     (0036), so deactivating a terminated employee's login runs through
 *     userAdmin's privileged path rather than the tenant transaction.
 */

export type ActionResult =
  | { success: true; id?: string; message?: string; warning?: string }
  | {
      success: false;
      error: string;
      fieldErrors?: Record<string, string>;
      /** What the user had typed, so a rejected form does not empty itself. */
      values?: Record<string, string>;
    };

/**
 * The text fields as submitted.
 *
 * A failed create used to come back with every box blank — twenty-odd fields
 * re-typed because one date was wrong. Files are left out; they cannot be
 * restored into an <input type="file"> anyway.
 */
function submitted(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const orNull = (fd: FormData, key: string) => str(fd, key) || null;
const num = (fd: FormData, key: string) => {
  const n = Number(str(fd, key) || 0);
  return Number.isFinite(n) ? n : 0;
};
/** Only what the form actually sent. An absent key must not clear a column. */
const sent = (fd: FormData, key: string) =>
  fd.has(key) ? (orNull(fd, key) ?? "") : undefined;

export async function createEmployee(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const fieldErrors: Record<string, string> = {};
  const firstName = str(formData, "firstName");
  const lastName = str(formData, "lastName");
  const hireDate = str(formData, "hireDate");
  if (!firstName) fieldErrors.firstName = "Required";
  if (!lastName) fieldErrors.lastName = "Required";
  if (!hireDate) fieldErrors.hireDate = "Required";
  if (Object.keys(fieldErrors).length) {
    return {
      success: false,
      error: "Please fill in all required fields",
      fieldErrors,
      values: submitted(formData),
    };
  }

  let id: string;
  try {
    const created = await withAuthorizedTenant(
      [...HR_WRITE_ROLES],
      (tx, { user, companyId }) =>
        employees.createEmployee(tx, {
          companyId,
          firstName,
          lastName,
          employeeNumber: orNull(formData, "employeeNumber"),
          email: orNull(formData, "email"),
          phone: orNull(formData, "phone"),
          dateOfBirth: orNull(formData, "dateOfBirth"),
          gender: orNull(formData, "gender"),
          nationalId: orNull(formData, "nationalId"),
          kraPin: orNull(formData, "kraPin"),
          nssfNumber: orNull(formData, "nssfNumber"),
          // The form key was renamed when NHIF became SHIF; both are accepted
          // so an older cached form does not silently drop the number.
          shaNumber: orNull(formData, "shaNumber") ?? orNull(formData, "nhifNumber"),
          nationality: orNull(formData, "nationality"),
          departmentId: orNull(formData, "departmentId"),
          designation: orNull(formData, "designation"),
          employmentType: orNull(formData, "employmentType"),
          hireDate,
          managerId: orNull(formData, "managerId"),
          workLocation: orNull(formData, "workLocation"),
          jobGrade: orNull(formData, "jobGrade"),
          contractStart: orNull(formData, "contractStart"),
          contractEnd: orNull(formData, "contractEnd"),
          contractType: orNull(formData, "contractType"),
          basicSalary: num(formData, "basicSalary"),
          allowanceHousing: num(formData, "housingAllowance"),
          allowanceTransport: num(formData, "transportAllowance"),
          allowanceMedical: num(formData, "medicalAllowance"),
          allowanceOther: num(formData, "otherAllowance"),
          paymentMethod: orNull(formData, "paymentMethod"),
          bankName: orNull(formData, "bankName"),
          bankAccount: orNull(formData, "bankAccount"),
          bankBranch: orNull(formData, "bankBranch"),
          mpesaNumber: orNull(formData, "mpesaNumber"),
          emergencyName: orNull(formData, "emergencyName"),
          emergencyRelationship: orNull(formData, "emergencyRelationship"),
          emergencyPhone: orNull(formData, "emergencyPhone"),
          userId: orNull(formData, "linkedUserId"),
          notes: orNull(formData, "notes"),
          actor: { id: user.id, name: user.name },
        }),
    );
    id = created.id;
  } catch (err) {
    return {
      success: false,
      error: userMessage(err, "Could not add the employee."),
      values: submitted(formData),
    };
  }

  revalidatePath("/dashboard/hr/employees");
  redirect(`/dashboard/hr/employees/${id}`);
}

export async function updateEmployee(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = str(formData, "employeeId") || str(formData, "profileId");
  if (!id) return { success: false, error: "Employee ID is required" };

  try {
    await withAuthorizedTenant([...HR_WRITE_ROLES], (tx, { user, companyId }) =>
      employees.updateEmployee(tx, {
        id,
        companyId,
        // `sent` distinguishes "left blank" from "not on this form", so a
        // partial form cannot clear the fields it does not show — and a blank
        // one CAN clear the field it does.
        firstName: str(formData, "firstName") || undefined,
        lastName: str(formData, "lastName") || undefined,
        employeeNumber: str(formData, "employeeNumber") || undefined,
        email: sent(formData, "email"),
        phone: sent(formData, "phone"),
        dateOfBirth: sent(formData, "dateOfBirth"),
        gender: sent(formData, "gender"),
        nationalId: sent(formData, "nationalId"),
        kraPin: sent(formData, "kraPin"),
        nssfNumber: sent(formData, "nssfNumber"),
        shaNumber: sent(formData, "shaNumber") ?? sent(formData, "nhifNumber"),
        passportNumber: sent(formData, "passportNumber"),
        nationality: sent(formData, "nationality"),
        departmentId: sent(formData, "departmentId"),
        designation: sent(formData, "designation"),
        employmentType: sent(formData, "employmentType"),
        managerId: sent(formData, "managerId"),
        workLocation: sent(formData, "workLocation"),
        jobGrade: sent(formData, "jobGrade"),
        contractStart: sent(formData, "contractStart"),
        contractEnd: sent(formData, "contractEnd"),
        contractType: sent(formData, "contractType"),
        shiftStart: sent(formData, "shiftStart"),
        shiftEnd: sent(formData, "shiftEnd"),
        emergencyName: sent(formData, "emergencyName"),
        emergencyRelationship: sent(formData, "emergencyRelationship"),
        emergencyPhone: sent(formData, "emergencyPhone"),
        notes: sent(formData, "notes"),
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return {
      success: false,
      error: userMessage(err, "Could not save the changes."),
      values: submitted(formData),
    };
  }

  revalidatePath("/dashboard/hr/employees");
  revalidatePath(`/dashboard/hr/employees/${id}`);
  redirect(`/dashboard/hr/employees/${id}`);
}

export async function updateCompensation(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = str(formData, "employeeId") || str(formData, "profileId");
  if (!id) return { success: false, error: "Employee ID is required" };

  try {
    await withAuthorizedTenant(
      [...HR_COMPENSATION_ROLES],
      (tx, { user, companyId }) =>
        employees.updateCompensation(tx, {
          id,
          companyId,
          basicSalary: num(formData, "basicSalary"),
          allowanceHousing: num(formData, "housingAllowance"),
          allowanceTransport: num(formData, "transportAllowance"),
          allowanceMedical: num(formData, "medicalAllowance"),
          allowanceOther: num(formData, "otherAllowance"),
          paymentMethod: orNull(formData, "paymentMethod"),
          bankName: orNull(formData, "bankName"),
          bankAccount: orNull(formData, "bankAccount"),
          bankBranch: orNull(formData, "bankBranch"),
          mpesaNumber: orNull(formData, "mpesaNumber"),
          effectiveDate: orNull(formData, "effectiveDate"),
          reason: orNull(formData, "reason"),
          actor: { id: user.id, name: user.name },
        }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not update compensation.") };
  }

  revalidatePath(`/dashboard/hr/employees/${id}`);
  revalidatePath(`/dashboard/hr/employees/${id}/compensation`);
  return { success: true, id };
}

export async function confirmEmployee(id: string): Promise<ActionResult> {
  try {
    await withAuthorizedTenant([...HR_WRITE_ROLES], (tx, { user, companyId }) =>
      employees.confirmEmployee(tx, {
        id,
        companyId,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not confirm the employee.") };
  }
  revalidatePath("/dashboard/hr/employees");
  revalidatePath(`/dashboard/hr/employees/${id}`);
  return { success: true, id };
}

/**
 * Ends an employment.
 *
 * The employment record and the party are closed inside the transaction; the
 * LOGIN is closed after it, through the privileged path, because `users` is a
 * platform table this tenant's scope does not reach. Failing to close the
 * login is reported rather than swallowed — somebody who has left keeping a
 * working session is the thing this is for.
 */
export async function terminateEmployee(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = str(formData, "employeeId") || str(formData, "profileId");
  if (!id) return { success: false, error: "Employee ID is required" };

  let userId: string | null = null;
  try {
    const done = await withAuthorizedTenant(
      [...HR_ADMIN_ROLES],
      async (tx, { user, companyId }) => {
        const updated = await employees.terminateEmployee(tx, {
          id,
          companyId,
          terminationDate: orNull(formData, "terminationDate"),
          reason: orNull(formData, "reason"),
          actor: { id: user.id, name: user.name },
        });
        return updated;
      },
    );
    userId = done.userId ?? null;
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not terminate the employee.") };
  }

  let warning: string | undefined;
  if (userId) {
    try {
      // Bumps tokenVersion as well as deactivating, so an issued JWT stops
      // working now rather than in eight hours.
      await deactivateUser(userId);
    } catch (err) {
      console.error("Could not deactivate the terminated employee's login:", err);
      warning =
        "The employee was terminated, but their login could not be deactivated. Deactivate it under Settings → Users.";
    }
  }

  revalidatePath("/dashboard/hr/employees");
  revalidatePath(`/dashboard/hr/employees/${id}`);
  return { success: true, id, ...(warning ? { warning } : {}) };
}

export async function setEmployeeStatus(
  id: string,
  status: "active" | "probation" | "on_leave" | "suspended",
  reason?: string,
): Promise<ActionResult> {
  try {
    await withAuthorizedTenant([...HR_ADMIN_ROLES], (tx, { user, companyId }) =>
      employees.setEmployeeStatus(tx, {
        id,
        companyId,
        status,
        reason: reason ?? null,
        actor: { id: user.id, name: user.name },
      }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not change the status.") };
  }
  revalidatePath("/dashboard/hr/employees");
  revalidatePath(`/dashboard/hr/employees/${id}`);
  return { success: true, id };
}

// ── Photo and documents ──────────────────────────────────────────────────────

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export async function uploadEmployeePhoto(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult & { url?: string }> {
  const id = str(formData, "employeeId") || str(formData, "profileId");
  const file = formData.get("photo");

  if (!id) return { success: false, error: "Employee ID is required" };
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "No photo selected" };
  }
  if (!file.type.startsWith("image/")) {
    return { success: false, error: "That file is not an image" };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { success: false, error: "The photo must be under 5MB" };
  }

  try {
    // Read the existing asset first, so the old one can be removed after the
    // new one is safely recorded.
    const existing = await withAuthorizedTenant([...HR_WRITE_ROLES], (tx) =>
      employees.getEmployee(tx, id),
    );
    if (!existing) return { success: false, error: "Employee not found" };

    const bytes = Buffer.from(await file.arrayBuffer()).toString("base64");
    const result = await cloudinary.uploader.upload(
      `data:${file.type};base64,${bytes}`,
      {
        folder: `hr/employees/${id}`,
        public_id: "photo",
        overwrite: true,
        transformation: [{ width: 400, height: 400, crop: "fill", gravity: "auto" }],
      },
    );

    await withAuthorizedTenant([...HR_WRITE_ROLES], (tx, { user }) =>
      employees.setEmployeePhoto(tx, {
        id,
        url: result.secure_url,
        publicId: result.public_id,
        actor: { id: user.id, name: user.name },
      }),
    );

    // Only once the new one is recorded, and only if it is a different asset —
    // the upload overwrites `photo`, so usually it is the same public id.
    if (existing.photoPublicId && existing.photoPublicId !== result.public_id) {
      await cloudinary.uploader
        .destroy(existing.photoPublicId, { resource_type: "image" })
        .catch(() => {});
    }

    revalidatePath(`/dashboard/hr/employees/${id}`);
    return { success: true, id, url: result.secure_url };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not upload the photo.") };
  }
}

export async function uploadEmployeeDocument(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = str(formData, "employeeId") || str(formData, "profileId");
  const docType = str(formData, "docType");
  const file = formData.get("file");

  if (!id || !docType) {
    return { success: false, error: "Employee and document type are required" };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "No file selected" };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { success: false, error: "The file must be under 10MB" };
  }

  try {
    const isImage = file.type.startsWith("image/");
    const resourceType = isImage ? ("image" as const) : ("raw" as const);
    const bytes = Buffer.from(await file.arrayBuffer()).toString("base64");

    const result = await cloudinary.uploader.upload(
      `data:${file.type};base64,${bytes}`,
      {
        folder: `hr/employees/${id}/documents`,
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true,
      },
    );

    await withAuthorizedTenant([...HR_WRITE_ROLES], (tx, { user, companyId }) =>
      employees.addEmployeeDocument(tx, {
        companyId,
        employeeId: id,
        docType,
        name: str(formData, "docName") || file.name || docType,
        url: result.secure_url,
        publicId: result.public_id,
        // Recorded, so the delete can name the right namespace. The Mongo
        // action always deletes as "raw", which silently misses every image.
        resourceType,
        expiryDate: orNull(formData, "expiryDate"),
        actor: { id: user.id, name: user.name },
      }),
    );

    revalidatePath(`/dashboard/hr/employees/${id}`);
    return { success: true, id };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not upload the document.") };
  }
}

export async function deleteEmployeeDocument(
  employeeId: string,
  documentId: string,
): Promise<ActionResult> {
  try {
    const { publicId, resourceType } = await withAuthorizedTenant(
      [...HR_ADMIN_ROLES],
      (tx) => employees.deleteEmployeeDocument(tx, documentId),
    );

    if (publicId) {
      await cloudinary.uploader
        .destroy(publicId, { resource_type: resourceType })
        .catch(() => {});
    }

    revalidatePath(`/dashboard/hr/employees/${employeeId}`);
    return { success: true, id: employeeId };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not delete the document.") };
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listEmployeesForPage(
  opts: {
    search?: string;
    departmentId?: string;
    status?: string;
    page?: number;
    limit?: number;
  } = {},
) {
  const limit = opts.limit ?? 20;
  const page = Math.max(opts.page ?? 1, 1);

  return withAuthorizedTenant([...HR_WRITE_ROLES], async (tx) => {
    const { rows, total } = await employees.listEmployees(tx, {
      search: opts.search,
      departmentId: opts.departmentId || null,
      status: opts.status || null,
      limit,
      offset: (page - 1) * limit,
    });
    return {
      employees: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  });
}

export async function getEmployeeForPage(id: string) {
  return withAuthorizedTenant([...HR_WRITE_ROLES], async (tx) => {
    const employee = await employees.getEmployee(tx, id);
    if (!employee) return null;
    const [documents, events, salary] = await Promise.all([
      employees.listEmployeeDocuments(tx, id),
      employees.listEmploymentEvents(tx, id),
      employees.listSalaryChanges(tx, id),
    ]);
    return { employee, documents, events, salary };
  });
}

/** Everything the create and edit forms need to render their pickers. */
export async function getEmployeeFormData() {
  return withAuthorizedTenant([...HR_WRITE_ROLES], async (tx) => {
    const [departmentList, managers] = await Promise.all([
      departments.listActiveDepartments(tx),
      employees.listEmployeesForPicker(tx, { limit: 50 }),
    ]);
    return { departments: departmentList, managers };
  });
}

export async function searchEmployees(search: string, excludeId?: string) {
  return withAuthorizedTenant([...HR_WRITE_ROLES], (tx) =>
    employees.listEmployeesForPicker(tx, { search, excludeId: excludeId ?? null }),
  );
}

export async function listUsersWithoutEmployeeRecord() {
  return withAuthorizedTenant([...HR_WRITE_ROLES], (tx) =>
    employees.listUsersWithoutEmployeeRecord(tx),
  );
}

export async function getHrOverview() {
  return withAuthorizedTenant([...HR_WRITE_ROLES], async (tx) => {
    const [stats, expiring] = await Promise.all([
      employees.getHeadcountStats(tx),
      employees.getExpiringContracts(tx, 30),
    ]);
    return { stats, expiringContracts: expiring };
  });
}
