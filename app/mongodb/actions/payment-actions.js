"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import Payment from "@/app/models/payment";
import Bill from "@/app/models/bill";
import Invoice from "@/app/models/invoice";
import Party from "@/app/models/parties";
import Account from "@/app/models/account";
import ApprovalRequest from "@/app/models/approvalRequest";
import { auth } from "@/auth";
import dbConnect from "@/app/config/dbConnect";
import { serializeBsonType } from "@/lib/utils";
import {
  getTenantContext,
  withTenantScope,
  getCompanyIdForCreate,
  buildTenantMatch,
} from "@/lib/utils/tenant-utils";
import { getCompanyThresholds } from "@/app/mongodb/queries/threshold-queries";
import { submitApproval } from "@/app/mongodb/actions/approval-actions";

// ============================================
// VALIDATION SCHEMAS
// ============================================

const AllocationSchema = z.object({
  documentType: z.enum(["invoice", "bill"]),
  documentId: z.string().min(1, "Document ID required"),
  documentNumber: z.string().min(1, "Document number required"),
  documentDate: z.string().optional(),
  originalAmount: z.coerce.number().min(0),
  balanceBefore: z.coerce.number().min(0),
  amountAllocated: z.coerce.number().min(0.01, "Amount must be positive"),
});

const CreatePaymentSchema = z
  .object({
    paymentType: z.enum(["received", "made"], {
      required_error: "Payment type is required",
    }),
    paymentDate: z.string().min(1, "Payment date is required"),
    amount: z.coerce.number().min(0.01, "Amount must be positive"),
    paymentMethod: z.enum(
      ["cash", "mpesa", "bank_transfer", "cheque", "card"],
      { required_error: "Payment method is required" },
    ),
    accountId: z.string().min(1, "Payment account is required"),
    partyId: z.string().min(1, "Party is required"),
    description: z.string().min(1, "Description is required").max(500),
    reference: z.string().max(100).optional(),
    notes: z.string().max(1000).optional(),

    // M-Pesa details
    mpesaTransactionCode: z.string().optional(),
    mpesaPhoneNumber: z.string().optional(),
    mpesaReceiptNumber: z.string().optional(),

    // Bank details
    bankName: z.string().optional(),
    bankAccountNumber: z.string().optional(),
    chequeNumber: z.string().optional(),
    bankTransactionReference: z.string().optional(),

    // Card details
    cardLast4Digits: z.string().optional(),
    cardType: z.string().optional(),
    cardApprovalCode: z.string().optional(),

    // Allocations (JSON string from form)
    allocations: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.paymentMethod === "mpesa" && !data.mpesaTransactionCode) {
        return false;
      }
      return true;
    },
    {
      message: "M-Pesa transaction code required",
      path: ["mpesaTransactionCode"],
    },
  )
  .refine(
    (data) => {
      if (data.paymentMethod === "cheque" && !data.chequeNumber) {
        return false;
      }
      return true;
    },
    { message: "Cheque number required", path: ["chequeNumber"] },
  );

// ============================================
// HELPER: Get current user
// ============================================
async function getCurrentUser() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return {
    name: session.user.name || session.user.email,
    id: session.user.id,
    role: session.user.role,
  };
}

// ============================================
// HELPER: Check role
// ============================================
function checkRole(user, allowedRoles) {
  const userRole = user.role?.toLowerCase();
  if (!allowedRoles.some((r) => r.toLowerCase() === userRole)) {
    throw new Error(
      `Access denied. Required roles: ${allowedRoles.join(", ")}`,
    );
  }
}

// ============================================
// HELPER: Serialize for client
// ============================================
function serializePayment(payment) {
  if (!payment) return null;

  const obj = payment.toObject ? payment.toObject() : { ...payment };

  return {
    ...obj,
    _id: obj._id?.toString(),
    id: obj._id?.toString(),
    account: obj.account
      ? {
          ...obj.account,
          id: obj.account.id?.toString(),
        }
      : null,
    party: obj.party
      ? {
          ...obj.party,
          partyId: obj.party.partyId?.toString(),
        }
      : null,
    allocations: obj.allocations?.map((a) => ({
      ...a,
      _id: a._id?.toString(),
      documentId: a.documentId?.toString(),
    })),
    journalEntryId: obj.journalEntryId?.toString(),
    createdAt: obj.createdAt?.toISOString(),
    updatedAt: obj.updatedAt?.toISOString(),
    paymentDate: obj.paymentDate?.toISOString(),
    confirmedAt: obj.confirmedAt?.toISOString(),
    cancelledAt: obj.cancelledAt?.toISOString(),
  };
}

// ============================================
// CREATE PAYMENT
// ============================================
export async function createPayment(prevState, formData) {
  // Parse form data early so we can return it on any error
  const rawData = {
    paymentType: formData.get("paymentType") || "",
    paymentDate: formData.get("paymentDate") || "",
    amount: formData.get("amount") || "",
    paymentMethod: formData.get("paymentMethod") || "",
    accountId: formData.get("accountId") || "",
    partyId: formData.get("partyId") || "",
    description: formData.get("description") || "",
    reference: formData.get("reference") || "",
    notes: formData.get("notes") || "",
    mpesaTransactionCode: formData.get("mpesaTransactionCode") || "",
    mpesaPhoneNumber: formData.get("mpesaPhoneNumber") || "",
    mpesaReceiptNumber: formData.get("mpesaReceiptNumber") || "",
    bankName: formData.get("bankName") || "",
    bankAccountNumber: formData.get("bankAccountNumber") || "",
    chequeNumber: formData.get("chequeNumber") || "",
    bankTransactionReference: formData.get("bankTransactionReference") || "",
    cardLast4Digits: formData.get("cardLast4Digits") || "",
    cardType: formData.get("cardType") || "",
    cardApprovalCode: formData.get("cardApprovalCode") || "",
    allocations: formData.get("allocations") || "",
  };

  try {
    await dbConnect();
    const user = await getCurrentUser();
    checkRole(user, ["superadmin", "admin", "cfo", "finance manager", "manager", "accountant"]);

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    const tenantCompanyId = getCompanyIdForCreate(null, companyId, isSuperAdmin);

    // Validate
    const validated = CreatePaymentSchema.safeParse(rawData);
    if (!validated.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: validated.error.flatten().fieldErrors,
        formData: rawData,
      };
    }

    const data = validated.data;

    // Parse allocations JSON
    let allocations = [];
    if (data.allocations) {
      try {
        const parsed = JSON.parse(data.allocations);
        const validatedAllocs = z.array(AllocationSchema).safeParse(parsed);
        if (validatedAllocs.success) {
          allocations = validatedAllocs.data;
        }
      } catch (e) {
        return { success: false, error: "Invalid allocations format", formData: rawData };
      }
    }

    // Validate total allocations don't exceed amount
    const totalAllocated = allocations.reduce(
      (sum, a) => sum + a.amountAllocated,
      0,
    );
    if (totalAllocated > data.amount + 0.01) {
      return {
        success: false,
        error: `Total allocated (${totalAllocated}) exceeds payment amount (${data.amount})`,
        formData: rawData,
      };
    }

    // Get party (tenant-scoped — never reference another tenant's party)
    const party = await Party.findOne(
      withTenantScope({ _id: data.partyId }, companyId, isSuperAdmin),
    );
    if (!party) {
      return { success: false, error: "Party not found", formData: rawData };
    }

    // Validate party type matches payment type ("both" qualifies for either)
    if (
      data.paymentType === "received" &&
      !["customer", "both"].includes(party.type)
    ) {
      return {
        success: false,
        error: "Received payments must be from customers",
        formData: rawData,
      };
    }
    if (
      data.paymentType === "made" &&
      !["supplier", "both"].includes(party.type)
    ) {
      return { success: false, error: "Made payments must be to suppliers", formData: rawData };
    }

    // Get account (tenant-scoped)
    const account = await Account.findOne(
      withTenantScope({ _id: data.accountId }, companyId, isSuperAdmin),
    );
    if (!account) {
      return { success: false, error: "Payment account not found", formData: rawData };
    }
    if (!["cash", "bank", "mpesa"].includes(account.subType)) {
      return {
        success: false,
        error: "Invalid account type. Must be cash, bank, or mpesa",
        formData: rawData,
      };
    }

    // Generate payment number (tenant-scoped)
    const paymentNumber = await Payment.generatePaymentNumber(data.paymentType, tenantCompanyId);

    // Calculate fiscal period from payment date (YYYY-MM)
    const paymentDateObj = new Date(data.paymentDate);
    const fiscalPeriod = `${paymentDateObj.getFullYear()}-${String(
      paymentDateObj.getMonth() + 1
    ).padStart(2, "0")}`;

    // Build payment document
    const paymentData = {
      paymentNumber,
      companyId: tenantCompanyId,
      paymentType: data.paymentType,
      paymentDate: new Date(data.paymentDate),
      fiscalPeriod,
      amount: data.amount,
      currency: "KES",
      paymentMethod: data.paymentMethod,

      account: {
        id: account._id,
        code: account.accountCode,
        name: account.accountName,
        subType: account.subType,
      },

      party: {
        // Derive party role from payment type (not the party's general type)
        type: data.paymentType === "received" ? "customer" : "supplier",
        partyId: party._id,
        name: party.name,
        email: party.email,
        phone: party.phone,
      },

      allocations: allocations.map((a) => ({
        documentType: a.documentType,
        documentId: a.documentId,
        documentNumber: a.documentNumber,
        documentDate: a.documentDate ? new Date(a.documentDate) : undefined,
        originalAmount: a.originalAmount,
        balanceBefore: a.balanceBefore,
        amountAllocated: a.amountAllocated,
      })),

      reference: data.reference || undefined,
      description: data.description,
      notes: data.notes || undefined,

      status: "draft",
      createdBy: { name: user.name, id: user.id },
    };

    // Add method-specific details
    if (data.paymentMethod === "mpesa") {
      paymentData.mpesaDetails = {
        transactionCode: data.mpesaTransactionCode,
        phoneNumber: data.mpesaPhoneNumber,
        receiptNumber: data.mpesaReceiptNumber,
      };
    }

    if (["bank_transfer", "cheque"].includes(data.paymentMethod)) {
      paymentData.bankDetails = {
        bankName: data.bankName,
        accountNumber: data.bankAccountNumber,
        chequeNumber: data.chequeNumber,
        transactionReference: data.bankTransactionReference,
      };
    }

    if (data.paymentMethod === "card") {
      paymentData.cardDetails = {
        last4Digits: data.cardLast4Digits,
        cardType: data.cardType,
        approvalCode: data.cardApprovalCode,
      };
    }

    // Create payment
    const payment = new Payment(paymentData);
    await payment.save();

    revalidatePath("/payments");
    revalidatePath("/bills");
    revalidatePath("/invoices");

    return {
      success: true,
      data: {
        id: payment._id.toString(),
        paymentNumber: payment.paymentNumber,
      },
    };
  } catch (error) {
    console.error("Create payment error:", error);
    return { success: false, error: error.message, formData: rawData };
  }
}

// ============================================
// UPDATE PAYMENT (Draft only)
// ============================================
export async function updatePayment(id, prevState, formData) {
  try {
    await dbConnect();
    const user = await getCurrentUser();
    checkRole(user, ["superadmin", "admin", "cfo", "finance manager", "manager", "accountant"]);

    // Get tenant context for access validation
    const { companyId, isSuperAdmin } = await getTenantContext();

    const payment = await Payment.findById(id);
    if (!payment) {
      return { success: false, error: "Payment not found" };
    }

    // Validate tenant access
    if (!isSuperAdmin && payment.companyId?.toString() !== companyId) {
      return { success: false, error: "Payment not found" };
    }

    if (!payment.canEdit) {
      return {
        success: false,
        error: "Cannot edit confirmed/cancelled payment",
      };
    }

    // Parse and validate (same as create)
    const rawData = {
      paymentType: formData.get("paymentType"),
      paymentDate: formData.get("paymentDate"),
      amount: formData.get("amount"),
      paymentMethod: formData.get("paymentMethod"),
      accountId: formData.get("accountId"),
      partyId: formData.get("partyId"),
      description: formData.get("description"),
      reference: formData.get("reference"),
      notes: formData.get("notes"),
      mpesaTransactionCode: formData.get("mpesaTransactionCode"),
      mpesaPhoneNumber: formData.get("mpesaPhoneNumber"),
      mpesaReceiptNumber: formData.get("mpesaReceiptNumber"),
      bankName: formData.get("bankName"),
      bankAccountNumber: formData.get("bankAccountNumber"),
      chequeNumber: formData.get("chequeNumber"),
      bankTransactionReference: formData.get("bankTransactionReference"),
      cardLast4Digits: formData.get("cardLast4Digits"),
      cardType: formData.get("cardType"),
      cardApprovalCode: formData.get("cardApprovalCode"),
      allocations: formData.get("allocations"),
    };

    const validated = CreatePaymentSchema.safeParse(rawData);
    if (!validated.success) {
      return {
        success: false,
        error: "Validation failed",
        fieldErrors: validated.error.flatten().fieldErrors,
      };
    }

    const data = validated.data;

    // Parse allocations
    let allocations = [];
    if (data.allocations) {
      try {
        allocations = JSON.parse(data.allocations);
      } catch (e) {
        return { success: false, error: "Invalid allocations format" };
      }
    }

    // Get party and account (tenant-scoped)
    const party = await Party.findOne(
      withTenantScope({ _id: data.partyId }, companyId, isSuperAdmin),
    );
    const account = await Account.findOne(
      withTenantScope({ _id: data.accountId }, companyId, isSuperAdmin),
    );

    if (!party || !account) {
      return { success: false, error: "Party or account not found" };
    }

    // Update fields
    payment.paymentDate = new Date(data.paymentDate);
    payment.amount = data.amount;
    payment.paymentMethod = data.paymentMethod;
    payment.description = data.description;
    payment.reference = data.reference;
    payment.notes = data.notes;

    payment.account = {
      id: account._id,
      code: account.accountCode,
      name: account.accountName,
      subType: account.subType,
    };

    payment.party = {
      type: party.type,
      partyId: party._id,
      name: party.name,
      email: party.email,
      phone: party.phone,
    };

    payment.allocations = allocations.map((a) => ({
      documentType: a.documentType,
      documentId: a.documentId,
      documentNumber: a.documentNumber,
      originalAmount: a.originalAmount,
      balanceBefore: a.balanceBefore,
      amountAllocated: a.amountAllocated,
    }));

    // Update method details
    if (data.paymentMethod === "mpesa") {
      payment.mpesaDetails = {
        transactionCode: data.mpesaTransactionCode,
        phoneNumber: data.mpesaPhoneNumber,
        receiptNumber: data.mpesaReceiptNumber,
      };
    }

    if (["bank_transfer", "cheque"].includes(data.paymentMethod)) {
      payment.bankDetails = {
        bankName: data.bankName,
        accountNumber: data.bankAccountNumber,
        chequeNumber: data.chequeNumber,
        transactionReference: data.bankTransactionReference,
      };
    }

    payment.lastModifiedBy = { name: user.name, id: user.id };

    await payment.save();

    revalidatePath("/payments");
    revalidatePath(`/payments/${id}`);

    return { success: true, data: { id: payment._id.toString() } };
  } catch (error) {
    console.error("Update payment error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// DELETE PAYMENT (Draft only)
// ============================================
export async function deletePayment(id) {
  try {
    await dbConnect();
    const user = await getCurrentUser();
    checkRole(user, ["superadmin", "admin", "cfo", "finance manager", "manager"]);

    // Get tenant context for access validation
    const { companyId, isSuperAdmin } = await getTenantContext();

    const payment = await Payment.findById(id);
    if (!payment) {
      return { success: false, error: "Payment not found" };
    }

    // Validate tenant access
    if (!isSuperAdmin && payment.companyId?.toString() !== companyId) {
      return { success: false, error: "Payment not found" };
    }

    if (payment.status !== "draft") {
      return { success: false, error: "Can only delete draft payments" };
    }

    await Payment.findByIdAndDelete(id);

    revalidatePath("/payments");

    return { success: true };
  } catch (error) {
    console.error("Delete payment error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// CONFIRM PAYMENT
// ============================================
export async function confirmPayment(id) {
  try {
    await dbConnect();
    const user = await getCurrentUser();
    checkRole(user, ["superadmin", "admin", "cfo", "finance manager", "manager", "accountant"]);

    // Get tenant context for access validation
    const { companyId, isSuperAdmin } = await getTenantContext();

    const payment = await Payment.findById(id);
    if (!payment) {
      return { success: false, error: "Payment not found" };
    }

    // Validate tenant access
    if (!isSuperAdmin && payment.companyId?.toString() !== companyId) {
      return { success: false, error: "Payment not found" };
    }

    // ============================================
    // APPROVAL GATE — Outbound bill payments above threshold
    // ============================================
    // Per-company threshold; finance leadership (Admin/CFO/Finance Manager)
    // bypass since they're the eventual approvers anyway. Inbound (received)
    // payments are revenue — no need to gate.
    const APPROVER_ROLES_BYPASS = new Set([
      "SuperAdmin",
      "Admin",
      "CFO",
      "Finance Manager",
    ]);
    const userRole = user?.role;
    const isOutbound = payment.paymentType === "made";
    const amount = Number(payment.amount) || 0;
    const userBypasses = APPROVER_ROLES_BYPASS.has(userRole);

    if (isOutbound && amount > 0 && !userBypasses) {
      const thresholds = await getCompanyThresholds(
        (companyId || payment.companyId)?.toString?.() || null,
      );
      const threshold = Number(thresholds.billPaymentValue) || 0;

      if (threshold > 0 && amount > threshold) {
        // Already pending? Don't create a duplicate request.
        const existing = await ApprovalRequest.findOne({
          companyId: payment.companyId,
          type: "bill_payment",
          status: "submitted",
          "targetRef.kind": "Payment",
          "targetRef.id": payment._id,
        }).select("_id requestNumber").lean();

        if (existing) {
          return {
            success: false,
            error: `Approval ${existing.requestNumber} is already pending for this payment.`,
            pendingApprovalId: existing._id.toString(),
          };
        }

        const result = await submitApproval({
          type: "bill_payment",
          targetRef: {
            kind: "Payment",
            id: payment._id,
            label: `${payment.paymentNumber} — ${payment.party?.name || "Supplier"} — KES ${amount.toLocaleString()}`,
          },
          payload: { paymentId: payment._id.toString() },
          reason: `Bill payment of KES ${amount.toLocaleString()} exceeds threshold of KES ${threshold.toLocaleString()}`,
          context: { amount, threshold },
        });

        if (!result.success) {
          return { success: false, error: result.error };
        }

        revalidatePath(`/payments/${id}`);
        return {
          success: false,
          error: `Payment exceeds the KES ${threshold.toLocaleString()} approval threshold. Approval ${result.approval.requestNumber} has been submitted.`,
          pendingApprovalId: result.approval._id,
          pendingApprovalNumber: result.approval.requestNumber,
        };
      }
    }

    await payment.confirm(user);

    revalidatePath("/payments");
    revalidatePath(`/payments/${id}`);
    revalidatePath("/bills");
    revalidatePath("/invoices");

    return {
      success: true,
      data: {
        id: payment._id.toString(),
        paymentNumber: payment.paymentNumber,
        journalEntryId: payment.journalEntryId?.toString(),
      },
    };
  } catch (error) {
    console.error("Confirm payment error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// CANCEL PAYMENT
// ============================================
export async function cancelPayment(id, prevState, formData) {
  try {
    await dbConnect();
    const user = await getCurrentUser();
    checkRole(user, ["superadmin", "admin", "cfo", "finance manager", "manager"]);

    const reason = formData.get("reason");
    if (!reason) {
      return { success: false, error: "Cancellation reason is required" };
    }

    // Get tenant context for access validation
    const { companyId, isSuperAdmin } = await getTenantContext();

    const payment = await Payment.findById(id);
    if (!payment) {
      return { success: false, error: "Payment not found" };
    }

    // Validate tenant access
    if (!isSuperAdmin && payment.companyId?.toString() !== companyId) {
      return { success: false, error: "Payment not found" };
    }

    await payment.cancel(user, reason);

    revalidatePath("/payments");
    revalidatePath(`/payments/${id}`);
    revalidatePath("/bills");
    revalidatePath("/invoices");

    return { success: true };
  } catch (error) {
    console.error("Cancel payment error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// RECONCILE PAYMENT
// ============================================
export async function reconcilePayment(id, prevState, formData) {
  try {
    await dbConnect();
    const user = await getCurrentUser();
    checkRole(user, ["superadmin", "admin", "cfo", "finance manager", "accountant"]);

    const statementRef = formData.get("statementReference");

    // Get tenant context for access validation
    const { companyId, isSuperAdmin } = await getTenantContext();

    const payment = await Payment.findById(id);
    if (!payment) {
      return { success: false, error: "Payment not found" };
    }

    // Validate tenant access
    if (!isSuperAdmin && payment.companyId?.toString() !== companyId) {
      return { success: false, error: "Payment not found" };
    }

    await payment.reconcile(user, statementRef);

    revalidatePath("/payments");
    revalidatePath(`/payments/${id}`);

    return { success: true };
  } catch (error) {
    console.error("Reconcile payment error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// GET PAYMENTS (List with filters)
// ============================================
export async function getPayments(filters = {}) {
  try {
    await dbConnect();

    // Get tenant context for scoping
    const { companyId, isSuperAdmin } = await getTenantContext();

    const {
      paymentType,
      status,
      paymentMethod,
      partyId,
      fiscalPeriod,
      isReconciled,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 20,
    } = filters;

    // Start with tenant filter
    const query = withTenantScope({}, companyId, isSuperAdmin);

    if (paymentType) query.paymentType = paymentType;
    if (status) query.status = status;
    if (paymentMethod) query.paymentMethod = paymentMethod;
    if (partyId) query["party.partyId"] = partyId;
    if (fiscalPeriod) query.fiscalPeriod = fiscalPeriod;
    if (typeof isReconciled === "boolean") {
      query["reconciliation.isReconciled"] = isReconciled;
    }

    if (startDate || endDate) {
      query.paymentDate = {};
      if (startDate) query.paymentDate.$gte = new Date(startDate);
      if (endDate) query.paymentDate.$lte = new Date(endDate);
    }

    if (search) {
      query.$or = [
        { paymentNumber: { $regex: search, $options: "i" } },
        { "party.name": { $regex: search, $options: "i" } },
        { reference: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { "mpesaDetails.transactionCode": { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .sort({ paymentDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payment.countDocuments(query),
    ]);

    return {
      success: true,
      data: serializeBsonType(payments),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    console.error("Get payments error:", error);
    return { success: false, error: error.message, data: [] };
  }
}

// ============================================
// GET SINGLE PAYMENT
// ============================================
export async function getPayment(id) {
  try {
    await dbConnect();

    // Get tenant context for access validation
    const { companyId, isSuperAdmin } = await getTenantContext();

    const payment = await Payment.findById(id);
    if (!payment) {
      return { success: false, error: "Payment not found" };
    }

    // Validate tenant access - prevent cross-company access
    if (!isSuperAdmin && payment.companyId?.toString() !== companyId) {
      return { success: false, error: "Payment not found" };
    }

    return { success: true, data: serializePayment(payment) };
  } catch (error) {
    console.error("Get payment error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// GET PAYMENT STATS (Dashboard)
// ============================================
export async function getPaymentStats() {
  try {
    await dbConnect();

    // Get tenant context for scoping
    const { companyId, isSuperAdmin } = await getTenantContext();
    const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
    );

    const [
      statusCounts,
      monthlyReceived,
      monthlyMade,
      unreconciledCount,
      byMethod,
    ] = await Promise.all([
      // Count by status
      Payment.aggregate([
        { $match: tenantMatch },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      // This month received
      Payment.aggregate([
        {
          $match: {
            ...tenantMatch,
            paymentType: "received",
            status: "confirmed",
            paymentDate: { $gte: startOfMonth, $lte: endOfMonth },
          },
        },
        {
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),

      // This month made
      Payment.aggregate([
        {
          $match: {
            ...tenantMatch,
            paymentType: "made",
            status: "confirmed",
            paymentDate: { $gte: startOfMonth, $lte: endOfMonth },
          },
        },
        {
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),

      // Unreconciled count
      Payment.countDocuments(
        withTenantScope(
          { status: "confirmed", "reconciliation.isReconciled": false },
          companyId,
          isSuperAdmin
        )
      ),

      // By payment method
      Payment.aggregate([
        { $match: { ...tenantMatch, status: "confirmed" } },
        {
          $group: {
            _id: "$paymentMethod",
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    return {
      success: true,
      data: {
        byStatus: statusCounts.reduce((acc, s) => {
          acc[s._id] = s.count;
          return acc;
        }, {}),
        thisMonth: {
          received: monthlyReceived[0] || { total: 0, count: 0 },
          made: monthlyMade[0] || { total: 0, count: 0 },
        },
        unreconciledCount,
        byMethod: byMethod.reduce((acc, m) => {
          acc[m._id] = { total: m.total, count: m.count };
          return acc;
        }, {}),
      },
    };
  } catch (error) {
    console.error("Get payment stats error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// GET UNPAID DOCUMENTS FOR ALLOCATION
// ============================================
export async function getUnpaidDocuments(partyId, documentType) {
  try {
    await dbConnect();

    // Get tenant context for scoping
    const { companyId, isSuperAdmin } = await getTenantContext();
    const tenantFilter = buildTenantMatch(companyId, isSuperAdmin);

    let documents = [];

    if (documentType === "bill") {
      documents = await Bill.find({
        ...tenantFilter,
        "supplier.partyId": partyId,
        status: "approved",
        paymentStatus: { $in: ["unpaid", "partial"] },
      })
        .select("billNumber billDate amounts.total amounts.balance dueDate")
        .sort({ dueDate: 1 })
        .lean();

      documents = documents.map((d) => ({
        id: d._id.toString(),
        documentNumber: d.billNumber,
        documentDate: d.billDate?.toISOString(),
        originalAmount: d.amounts?.total || 0,
        balance: d.amounts?.balance || 0,
        dueDate: d.dueDate?.toISOString(),
      }));
    } else if (documentType === "invoice") {
      documents = await Invoice.find({
        ...tenantFilter,
        "customer.id": partyId,
        status: "completed",
        paymentStatus: { $in: ["unpaid", "partial"] },
      })
        .select("invoiceNumber invoiceDate total amountDue dueDate")
        .sort({ dueDate: 1 })
        .lean();

      documents = documents.map((d) => ({
        id: d._id.toString(),
        documentNumber: d.invoiceNumber,
        documentDate: d.invoiceDate?.toISOString(),
        originalAmount: d.total || 0,
        balance: d.amountDue || 0,
        dueDate: d.dueDate?.toISOString(),
      }));
    }

    return { success: true, data: documents };
  } catch (error) {
    console.error("Get unpaid documents error:", error);
    return { success: false, error: error.message, data: [] };
  }
}

// ============================================
// GET PAYMENT ACCOUNTS
// ============================================
export async function getPaymentAccounts() {
  try {
    await dbConnect();

    // Get tenant context for scoping
    const { companyId, isSuperAdmin } = await getTenantContext();

    const accounts = await Account.find(
      withTenantScope(
        {
          subType: { $in: ["cash", "bank", "mpesa"] },
          isActive: true,
          canPost: true,
        },
        companyId,
        isSuperAdmin
      )
    )
      .select("accountCode accountName subType balance")
      .sort({ subType: 1, accountName: 1 })
      .lean();

    return {
      success: true,
      data: accounts.map((a) => ({
        id: a._id.toString(),
        code: a.accountCode,
        name: a.accountName,
        subType: a.subType,
        balance: a.balance || 0,
      })),
    };
  } catch (error) {
    console.error("Get payment accounts error:", error);
    return { success: false, error: error.message, data: [] };
  }
}
