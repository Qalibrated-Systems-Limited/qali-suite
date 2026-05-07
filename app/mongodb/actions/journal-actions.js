"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import mongoose from "mongoose";

import JournalEntry from "@/app/models/JournalEntry";
import Account from "@/app/models/account";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { generateUniqueEntryNumber } from "@/lib/utils/server-utils";
import { requirePlanAccess } from "@/lib/plan-gate";

// ============================================
// VALIDATION SCHEMA
// ============================================
const journalLineSchema = z.object({
  accountId: z.string().min(1, "Account is required"),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  description: z.string().optional(),
});

const createJournalEntrySchema = z.object({
  entryDate: z.coerce.date(),
  entryType: z.enum([
    "adjustment",
    "opening_balance",
    "closing",
    "transfer",
    "contra",
    "bank_entry",
    "cash_entry",
    "accrual",
    "depreciation",
    "write_off",
    "revaluation",
    "other",
  ]),
  description: z.string().min(1, "Description is required"),
  reference: z.string().optional(),
  notes: z.string().optional(),
  lines: z
    .array(journalLineSchema)
    .min(2, "At least 2 lines required")
    .refine(
      (lines) => {
        const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
        const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
        return Math.abs(totalDebit - totalCredit) < 0.01;
      },
      { message: "Debits must equal Credits" }
    )
    .refine(
      (lines) => lines.every((l) => l.debit > 0 || l.credit > 0),
      { message: "Each line must have either debit or credit" }
    )
    .refine(
      (lines) => lines.every((l) => !(l.debit > 0 && l.credit > 0)),
      { message: "A line cannot have both debit and credit" }
    ),
  postImmediately: z.coerce.boolean().default(false),
});


// ============================================
// CREATE MANUAL JOURNAL ENTRY
// ============================================
export async function createManualJournalEntry(prevState, formData) {
  await dbConnect();
  const { user, companyId } = await getTenantContext();

  if (
    !user ||
    !["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(
      user.role,
    )
  ) {
    return { success: false, error: "You don't have permission to manage journal entries." };
  }

  try {
    await requirePlanAccess("finance");

    // Parse lines from FormData
    const linesData = [];
    let i = 0;
    while (formData.has(`lines[${i}].accountId`)) {
      linesData.push({
        accountId: formData.get(`lines[${i}].accountId`),
        debit: formData.get(`lines[${i}].debit`) || 0,
        credit: formData.get(`lines[${i}].credit`) || 0,
        description: formData.get(`lines[${i}].description`) || "",
      });
      i++;
    }

    const rawData = {
      entryDate: formData.get("entryDate"),
      entryType: formData.get("entryType"),
      description: formData.get("description"),
      reference: formData.get("reference") || "",
      notes: formData.get("notes") || "",
      lines: linesData,
      postImmediately: formData.get("postImmediately") === "true",
    };

    // Validate
    const validated = createJournalEntrySchema.parse(rawData);

    // Fetch account details for each line
    const accountIds = validated.lines.map((l) => l.accountId);
    const accounts = await Account.find({
      _id: { $in: accountIds },
      companyId,
    }).lean();

    const accountMap = new Map(accounts.map((a) => [a._id.toString(), a]));

    // Build lines with cached account info
    const lines = validated.lines.map((line) => {
      const account = accountMap.get(line.accountId);
      if (!account) {
        throw new Error(`Account ${line.accountId} not found`);
      }
      return {
        accountId: account._id,
        accountCode: account.accountCode,
        accountName: account.accountName,
        accountType: account.accountType,
        debit: line.debit || 0,
        credit: line.credit || 0,
        description: line.description || "",
      };
    });

    // Generate entry number
    const entryNumber = await generateUniqueEntryNumber("MAN", companyId);

    // Create journal entry
    const entry = new JournalEntry({
      companyId,
      entryNumber,
      entryDate: validated.entryDate,
      entryType: validated.entryType,
      description: validated.description,
      reference: validated.reference,
      notes: validated.notes,
      lines,
      status: "draft",
      createdBy: { name: user.name, id: user.id },
      fiscalYear: validated.entryDate.getFullYear(),
      fiscalMonth: validated.entryDate.getMonth() + 1,
    });

    await entry.save();

    // Post immediately if requested
    if (validated.postImmediately) {
      await entry.post({ name: user.name, id: user.id });
    }

    revalidatePath("/dashboard/journal");

    return {
      success: true,
      entryId: entry._id.toString(),
      entryNumber: entry.entryNumber,
      status: entry.status,
    };
  } catch (error) {
    console.error("Create journal entry error:", error);

    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: error.flatten().fieldErrors,
      };
    }

    return {
      success: false,
      error: error.message || "Failed to create journal entry",
    };
  }
}

// ============================================
// POST JOURNAL ENTRY
// ============================================
export async function postJournalEntry(entryId) {
  await dbConnect();
  const { user, companyId } = await getTenantContext();

  if (
    !user ||
    !["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(
      user.role,
    )
  ) {
    return { success: false, error: "You don't have permission to manage journal entries." };
  }

  try {
    const entry = await JournalEntry.findOne({ _id: entryId, companyId });

    if (!entry) {
      return { success: false, error: "Journal entry not found" };
    }

    await entry.post({ name: user.name, id: user.id });

    revalidatePath("/dashboard/journal");
    revalidatePath(`/dashboard/journal/${entryId}`);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// DELETE DRAFT JOURNAL ENTRY
// ============================================
export async function deleteDraftJournalEntry(entryId) {
  await dbConnect();
  const { user, companyId } = await getTenantContext();

  if (
    !user ||
    !["SuperAdmin", "Admin", "CFO", "Finance Manager", "Accountant"].includes(
      user.role,
    )
  ) {
    return { success: false, error: "You don't have permission to manage journal entries." };
  }

  try {
    const entry = await JournalEntry.findOne({ _id: entryId, companyId });

    if (!entry) {
      return { success: false, error: "Journal entry not found" };
    }

    if (entry.status !== "draft") {
      return { success: false, error: "Only draft entries can be deleted" };
    }

    await entry.deleteOne();

    revalidatePath("/dashboard/journal");

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
