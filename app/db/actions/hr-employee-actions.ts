"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withAuthorizedTenant } from "../tenant";
import {
  HR_VIEW_ROLES,
  HR_WRITE_ROLES,
  HR_ADMIN_ROLES,
  HR_COMPENSATION_ROLES,
} from "@/lib/utils/role-gates";
import { userMessage } from "../errors";
import * as employees from "../repositories/employees";
import * as departments from "../repositories/departments";
import * as leave from "../repositories/leave";
import * as payrollRepo from "../repositories/payroll";
import { deactivateUser } from "../userAdmin";
import { sendInvitePg } from "./invite-actions";
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

export interface ImportRow {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  nationalId?: string;
  kraPin?: string;
  nssfNumber?: string;
  shaNumber?: string;
  nhifNumber?: string;
  gender?: string;
  department?: string;
  designation?: string;
  employmentType?: string;
  hireDate?: string;
  basicSalary?: string;
  housingAllowance?: string;
  transportAllowance?: string;
  paymentMethod?: string;
  bankName?: string;
  bankAccount?: string;
  bankBranch?: string;
  mpesaNumber?: string;
}

/**
 * Bulk import from a CSV the client has already parsed.
 *
 * Two things the source does not do:
 *
 *   - THE DEPARTMENT BECOMES A REAL DEPARTMENT. The source writes the name as
 *     a string and never resolves an id, so every imported employee lands with
 *     a department no picker offers and no report groups by. Here the name is
 *     matched against the existing departments, and created if it is new.
 *
 *   - EACH ROW IS ITS OWN TRANSACTION. One bad row does not take the other
 *     199 with it, and a row that fails is reported by name rather than
 *     counted.
 *
 * Leave entitlement for the current year is granted as part of the import, so
 * an imported employee can request leave the same day.
 */
export async function bulkImportEmployees(rows: ImportRow[]) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { success: false as const, error: "There is nothing to import." };
  }
  if (rows.length > 200) {
    return { success: false as const, error: "Import at most 200 rows at a time." };
  }

  const results: Array<{
    row: number;
    status: "created" | "skipped" | "error";
    name?: string;
    employeeNumber?: string;
    message?: string;
  }> = [];

  const year = new Date().getFullYear();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? {};
    // +2: one-indexed, plus the header row, so the number matches the
    // spreadsheet the person is looking at.
    const rowNumber = i + 2;
    const firstName = (row.firstName ?? "").trim();
    const lastName = (row.lastName ?? "").trim();
    const name = `${firstName} ${lastName}`.trim();

    if (!firstName || !lastName) {
      results.push({
        row: rowNumber,
        status: "error",
        message: "First name and last name are required",
      });
      continue;
    }

    try {
      const created = await withAuthorizedTenant(
        [...HR_ADMIN_ROLES],
        async (tx, { user, companyId }) => {
          const departmentName = (row.department ?? "").trim();
          let departmentId: string | null = null;
          if (departmentName) {
            const existing = await departments.listActiveDepartments(tx);
            const match = existing.find(
              (d) => d.name.toLowerCase() === departmentName.toLowerCase(),
            );
            departmentId =
              match?.id ??
              (
                await departments.createDepartment(tx, {
                  companyId,
                  name: departmentName,
                  actor: { id: user.id, name: user.name },
                })
              ).id;
          }

          const employee = await employees.createEmployee(tx, {
            companyId,
            firstName,
            lastName,
            email: (row.email ?? "").trim().toLowerCase() || null,
            phone: (row.phone ?? "").trim() || null,
            nationalId: (row.nationalId ?? "").trim() || null,
            kraPin: (row.kraPin ?? "").trim() || null,
            nssfNumber: (row.nssfNumber ?? "").trim() || null,
            shaNumber:
              (row.shaNumber ?? "").trim() || (row.nhifNumber ?? "").trim() || null,
            gender: ["male", "female", "other"].includes(
              (row.gender ?? "").toLowerCase(),
            )
              ? (row.gender ?? "").toLowerCase()
              : null,
            departmentId,
            designation: (row.designation ?? "").trim() || null,
            employmentType: [
              "full_time", "part_time", "contract", "intern", "casual",
            ].includes((row.employmentType ?? "").trim())
              ? (row.employmentType ?? "").trim()
              : "full_time",
            hireDate:
              (row.hireDate ?? "").trim() || new Date().toISOString().slice(0, 10),
            basicSalary: Number(row.basicSalary ?? 0) || 0,
            allowanceHousing: Number(row.housingAllowance ?? 0) || 0,
            allowanceTransport: Number(row.transportAllowance ?? 0) || 0,
            paymentMethod: ["bank", "mpesa", "cash"].includes(
              (row.paymentMethod ?? "").trim(),
            )
              ? (row.paymentMethod ?? "").trim()
              : "bank",
            bankName: (row.bankName ?? "").trim() || null,
            bankAccount: (row.bankAccount ?? "").trim() || null,
            bankBranch: (row.bankBranch ?? "").trim() || null,
            mpesaNumber: (row.mpesaNumber ?? "").trim() || null,
            actor: { id: user.id, name: user.name },
          });

          await leave.grantYearEntitlements(tx, {
            companyId,
            employeeId: employee.id,
            year,
            gender: employee.gender,
          });

          return employee;
        },
      );

      results.push({
        row: rowNumber,
        status: "created",
        name,
        employeeNumber: created.employeeNumber,
      });
    } catch (err) {
      const message = userMessage(err, "Could not import this row.");
      // A duplicate is not a failure worth alarming anybody about; it is a
      // row that was already there.
      const duplicate = /already in use|already has an employee record/i.test(message);
      results.push({
        row: rowNumber,
        status: duplicate ? "skipped" : "error",
        name,
        message,
      });
    }
  }

  revalidatePath("/dashboard/hr/employees");
  return {
    success: true as const,
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  };
}

/**
 * Invites an employee to the portal.
 *
 * Their email lives on the party, so it is read from there rather than typed
 * again — the source asks the caller for one and can therefore invite an
 * address that is not the employee's.
 *
 * The invite carries the party id, so accepting it links the login back to the
 * same person rather than creating a second identity.
 */
export async function inviteEmployeeToPortal(
  employeeId: string,
  role = "Employee",
): Promise<ActionResult> {
  const ALLOWED = [
    "Employee", "Manager", "Accountant", "HR Manager", "Store Manager", "Admin",
  ];
  const inviteRole = ALLOWED.includes(role) ? role : "Employee";

  let email: string;
  let partyId: string;
  try {
    const employee = await withAuthorizedTenant([...HR_ADMIN_ROLES], (tx) =>
      employees.getEmployee(tx, employeeId),
    );
    if (!employee) return { success: false, error: "Employee not found" };
    if (employee.userId) {
      return { success: false, error: "This employee already has a portal login." };
    }
    if (!employee.email) {
      return {
        success: false,
        error: "This employee has no email address. Add one first, then invite them.",
      };
    }
    email = employee.email;
    partyId = employee.partyId;
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not read the employee.") };
  }

  const formData = new FormData();
  formData.set("email", email);
  formData.set("role", inviteRole);
  formData.set("partyId", partyId);

  const result = await sendInvitePg(null, formData);
  revalidatePath(`/dashboard/hr/employees/${employeeId}`);

  if (result.success !== true) {
    return { success: false, error: result.error };
  }
  return {
    success: true,
    id: employeeId,
    message: result.message,
    ...(result.warning ? { warning: result.warning } : {}),
  };
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

/**
 * Attaches a login that ALREADY EXISTS to an employment record.
 *
 * ── THE HOLE THIS FILLS ────────────────────────────────────────────────────
 *
 * Two flows joined a person to their login, and between them they left a gap
 * that nothing could close.
 *
 *   * Employee first, no login: "Send Portal Invite" carries the employee's
 *     party id, and `linkUserToPartyDirect` sets `employees.user_id` when the
 *     invite is accepted (userAdmin.ts). Works.
 *
 *   * Login first, no employee: the amber strip on the employees page offers
 *     "create an employee profile", which carries ?userId= and sets the link
 *     at creation. Works.
 *
 *   * BOTH ALREADY EXIST, SEPARATELY: nothing. Invite acceptance refuses with
 *     "That email already has a login. Sign in instead.", and the amber strip's
 *     only remedy is to CREATE an employee — which for somebody who already
 *     has one either trips employees_company_number_uq or quietly produces a
 *     second employment record for one person.
 *
 * That third case is ordinary: a person signed up or was invited as a plain
 * user before HR wrote their record, or the two sides came from different
 * imports. Until this existed they could log in and never see their own
 * payslip, leave balance or attendance, and the two buttons on offer both
 * made it worse.
 *
 * `linkEmployeeUser` has been sitting in the repository with NO CALLERS since
 * it was written. This is its caller.
 *
 * HR_ADMIN_ROLES, matching invite and terminate: deciding which login is which
 * person is an identity decision, not an edit to their details.
 */
export async function linkEmployeeLogin(
  employeeId: string,
  userId: string,
): Promise<ActionResult> {
  if (!employeeId) return { success: false, error: "Employee ID is required" };
  if (!userId) return { success: false, error: "Choose a login to link." };

  try {
    await withAuthorizedTenant([...HR_ADMIN_ROLES], async (tx) => {
      const employee = await employees.getEmployee(tx, employeeId);
      if (!employee) throw new Error("Employee not found");
      if (employee.userId) {
        throw new Error("This employee already has a portal login.");
      }
      return employees.linkEmployeeUser(tx, { id: employeeId, userId });
    });
  } catch (err) {
    /*
     * employees_company_user_uq is what refuses a login already attached to
     * somebody else — "two employment records sharing a login would make
     * 'whose leave is this' unanswerable" (0045). `userMessage` turns that
     * constraint into the sentence written for it rather than a page of SQL.
     */
    return { success: false, error: userMessage(err, "Could not link that login.") };
  }

  revalidatePath(`/dashboard/hr/employees/${employeeId}`);
  revalidatePath("/dashboard/hr/employees");
  return { success: true, id: employeeId, message: "Login linked." };
}

/**
 * Detaches the login, leaving both records in place.
 *
 * NOT a deactivation and not a termination — the person keeps their account
 * and the employment record keeps its history. It is the undo for a link made
 * to the wrong person, which is the only way a wrong link can be fixed:
 * `linkEmployeeLogin` refuses an employee who already has one, deliberately,
 * so that correcting a mistake is two explicit steps rather than a silent
 * overwrite of who somebody is.
 */
export async function unlinkEmployeeLogin(
  employeeId: string,
): Promise<ActionResult> {
  if (!employeeId) return { success: false, error: "Employee ID is required" };

  try {
    await withAuthorizedTenant([...HR_ADMIN_ROLES], (tx) =>
      employees.linkEmployeeUser(tx, { id: employeeId, userId: null }),
    );
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not unlink that login.") };
  }

  revalidatePath(`/dashboard/hr/employees/${employeeId}`);
  revalidatePath("/dashboard/hr/employees");
  return { success: true, id: employeeId, message: "Login unlinked." };
}

export async function listUsersWithoutEmployeeRecord() {
  return withAuthorizedTenant([...HR_WRITE_ROLES], (tx) =>
    employees.listUsersWithoutEmployeeRecord(tx),
  );
}

/**
 * Employees as owner candidates, for modules outside HR that name one.
 *
 * Read-only and forgiving: a tenant with no HR records gets an empty list, and
 * the caller falls back to free text. Anybody who can see HR may pick.
 */
export async function listEmployeesForOwnerPicker(limit = 200) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      employees.listEmployeesForPicker(tx, { limit }),
    );
  } catch {
    return [];
  }
}

/**
 * The HR facts other modules snapshot onto their own documents: the employee
 * number, the department and the designation.
 *
 * Keyed on the PARTY, because that is the id the ledger-side modules — claims,
 * expenses, payments — already hold. Returns blanks rather than throwing: a
 * claim raised by somebody with no HR record is still a claim.
 */
export async function getEmployeeSnapshotByParty(partyId: string) {
  try {
    const employee = await withAuthorizedTenant([], (tx) =>
      employees.getEmployeeByParty(tx, partyId),
    );
    return {
      employeeNumber: employee?.employeeNumber ?? "",
      department: employee?.department ?? "",
      designation: employee?.designation ?? "",
    };
  } catch {
    return { employeeNumber: "", department: "", designation: "" };
  }
}

/** Headcount, for a KPI or a dashboard. Excludes people who have left. */
export async function getActiveHeadcount() {
  try {
    const stats = await withAuthorizedTenant([], (tx) =>
      employees.getHeadcountStats(tx),
    );
    return stats.active + stats.probation;
  } catch {
    return 0;
  }
}

/**
 * How much HR history a party has: leave requests and payslips.
 *
 * Asked before deleting a party. A party with an employment record cannot be
 * hard-deleted anyway — `employees.party_id` is a foreign key to it — but the
 * counts let the caller say WHY rather than quoting a constraint.
 */
export async function countHrHistoryForParty(partyId: string) {
  try {
    return await withAuthorizedTenant([], async (tx) => {
      const employee = await employees.getEmployeeByParty(tx, partyId);
      if (!employee) return { leaveCount: 0, payrollCount: 0 };

      const [leaveRows, payslips] = await Promise.all([
        leave.listLeaveRequests(tx, { employeeId: employee.id, limit: 1 }),
        payrollRepo.listEmployeePayslips(tx, { employeeId: employee.id, limit: 1 }),
      ]);
      return { leaveCount: leaveRows.total, payrollCount: payslips.length };
    });
  } catch {
    // Failing closed here would block a delete for the wrong reason; the
    // foreign key is the real guard.
    return { leaveCount: 0, payrollCount: 0 };
  }
}

/**
 * The signed-in person's own employee record, if they have one.
 *
 * For the profile page and anything else that shows somebody their own
 * details. Never throws — not being an employee is a normal state.
 */
export async function getMyEmployeeRecord() {
  try {
    return await withAuthorizedTenant([], (tx, { user }) =>
      employees.getEmployeeByUser(tx, user.id),
    );
  } catch {
    return null;
  }
}

/**
 * The four numbers on the HR alerts strip, from Postgres.
 *
 * "On leave today" is a question about dates, answered by the
 * `employees_on_leave` view — not a status flag on the employee that a sweep
 * has to remember to set and unset.
 */
export async function getHrAlertCounts() {
  try {
    return await withAuthorizedTenant([...HR_VIEW_ROLES], async (tx) => {
      const [pendingLeave, onLeave, expiring] = await Promise.all([
        leave.countPendingApprovals(tx),
        leave.getEmployeesOnLeaveToday(tx),
        employees.getExpiringContracts(tx, 30),
      ]);
      return {
        pendingLeave,
        contractsExpiring: expiring.length,
        onLeaveToday: onLeave.length,
      };
    });
  } catch {
    return { pendingLeave: 0, contractsExpiring: 0, onLeaveToday: 0 };
  }
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
