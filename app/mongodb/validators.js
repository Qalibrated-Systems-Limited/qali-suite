import { z } from "zod";
import { roles } from "../utils/roles";
import { units } from "../utils/units";

export const accountForm = z.object({
  name: z.string().max(100).min(4),
  address: z.string().max(100).min(4),

  phoneNumber: z.string().min(10).max(12),
  email: z.string().email().optional(),
});

const ruimbursementPaymentSchema = z.object({
  paymentMethod: z.enum(["bank_transfer", "cash", "check"], {
    required_error: "Please select a payment method",
  }),
  transactionReference: z.string().min(3).max(100).optional(),
});

export const expenseItemSchema = z.object({
  date: z.coerce.date(),

  category: z.string().min(1, "Category is required"),

  expenseAccountId: z.string().min(1, "Expense account is required"),

  description: z.string().min(3),

  amount: z.coerce.number().positive(),

  receipt: z
    .object({
      filename: z.string(),
      url: z.string().url(),
      uploadedAt: z.coerce.date().optional(),
    })
    .optional(),

  notes: z.string().optional(),
});

const itemsSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}, z.array(expenseItemSchema).min(1, "At least one item is required"));

export const reimbursementSchema = z.object({
  description: z
    .string()
    .min(10, "Description must be at least 10 characters long")
    .max(200, "Description must be at most 200 characters long"),
  notes: z
    .string()
    .max(500, "Notes must be at most 500 characters long")
    .optional()
    .or(z.literal("")),
  items: itemsSchema,
});

// Define advance types as a const tuple for z.enum
// "project" removed — project linking is cross-cutting via project picker
const advanceTypesEnum = ["travel", "petty_cash", "operational"];

export const advanceRequestSchema = z
  .object({
    advanceType: z.enum(advanceTypesEnum, {
      required_error: "Please select an advance type",
    }),

    requestedAmount: z.coerce
      .number()
      .positive("Requested amount must be greater than zero"),

    purpose: z
      .string()
      .min(5, "Purpose is required")
      .max(200, "Purpose is too long"),

    // Travel-specific (optional - validated conditionally)
    destination: z.preprocess(
      (val) => (val === null ? undefined : val),
      z.string().max(100, "Destination is too long").optional()
    ),

    travelFromDate: z.preprocess(
      (val) => (val === null ? undefined : val),
      z.string().optional()
    ),

    travelToDate: z.preprocess(
      (val) => (val === null ? undefined : val),
      z.string().optional()
    ),

    // Project picker (optional — available for all advance types)
    projectId: z.preprocess(
      (val) => (val === null ? undefined : val),
      z.string().optional()
    ),

    // Common optional fields
    estimatedExpenses: z.preprocess(
      (val) => (val === null ? undefined : val),
      z.string().max(200, "Estimated expenses too long").optional()
    ),
    notes: z.preprocess(
      (val) => (val === null ? undefined : val),
      z.string().max(500, "Notes too long").optional()
    ),
  })
  .superRefine((data, ctx) => {
    // Travel type requires destination and dates
    if (data.advanceType === "travel") {
      if (!data.destination?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Destination is required for travel advances",
          path: ["destination"],
        });
      }
      if (!data.travelFromDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Travel start date is required",
          path: ["travelFromDate"],
        });
      }
      if (!data.travelToDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Travel end date is required",
          path: ["travelToDate"],
        });
      }
      // Date validation
      if (data.travelFromDate && data.travelToDate) {
        const fromDate = new Date(data.travelFromDate);
        const toDate = new Date(data.travelToDate);
        if (toDate < fromDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Travel end date cannot be before start date",
            path: ["travelToDate"],
          });
        }
      }
    }

  });

export const deliveryNoteZodSchema = z.object({
  notes: z.string().max(100).min(4),
  customerId: z.string().min(1),
  techId: z.string().min(1),
  reason: z.enum(["Selling", "Borrrowing", "Giving out for tests "]),
});

export const invoiceItemForm = z.object({
  name: z.string().min(2).max(60),
  unit: z.string(),
  unitPrice: z.string().optional(),
  type: z.enum(["Stock", "Service"]),
  quantity: z.string().min(1).refine(
    (val) => Number.isInteger(Number(val)) && Number(val) > 0,
    { message: "Quantity must be a positive whole number" }
  ),
  serialNo: z.string().optional(),
});

export const updateAccountForm = z.object({
  name: z.string().max(100).min(4),
  address: z.string().min(4),
  phoneNumber: z.string().length(12),
  email: z.string().email().optional(),

  status: z.enum(["Active", "Inactive"], {
    invalid_type_error: "Status should be either Active or Inactive.",
    required_error: "Status should be either Active or Inactive.",
  }),
});

export const stockForm = z.object({
  name: z.string(),
  SKU: z
    .string()
    .min(3, "SKU must be at least 3 characters long")
    .max(50, "SKU must be no more than 50 characters long")
    .regex(
      /^[A-Z0-9-]+$/,
      "SKU must contain only uppercase letters, numbers, and dashes"
    ),
  price: z.string(),
  category: z.string(),
  stock: z.string().refine(
    (val) => Number.isInteger(Number(val)) && Number(val) >= 0,
    { message: "Stock must be a non-negative whole number" }
  ),
  unit: z.enum(units),
  description: z.string(),
});
export const invoiceForm = z.object({
  description: z.string().min(8).max(50),
  status: z.enum(["Paid", "Unpaid"]),
  customerId: z.string(),
  dNoteNumber: z.string(),
  taxRate: z.string().min(2).max(2),
});

export const updateInvoiceForm = z.object({
  description: z.string().min(8).max(50),
  status: z.enum(["Paid", "Unpaid"]),
  customerId: z.string(),
  discount: z.string().min(1).max(2),
  taxRate: z.string().min(1).max(2),
  dNoteNumber: z.string(),
});

export const updatedInvoiceWithIdSchema = updateInvoiceForm.extend({
  id: z.string(),
});

export const settingsForm = z.object({
  isLocked: z.enum(["0", "1"], {
    invalid_type_error: "Please provide a valid value.",
    required_error: "Please provide a valid value.",
  }),
  maxCapacity: z.string(),
  minCapacity: z.string(),
  weigherId: z.string(),
  division: z.string(),
});

const userForm = z.object({
  password: z
    .string({
      invalid_type_error: "Please provide password.",
      required_error: "Please provide password.",
    })
    .min(8, { message: "Password must be at least 8 characters long" })
    .regex(/[A-Z]/, {
      message: "Password must contain at least one uppercase letter",
    })
    .regex(/[a-z]/, {
      message: "Password must contain at least one lowercase letter",
    })
    .regex(/[0-9]/, { message: "Password must contain at least one digit" }),
  email: z
    .string({
      invalid_type_error: "Please provide email.",
      required_error: "Please provide email.",
    })
    .min(1, { message: "This field has to be filled." })
    .email("This is not a valid email."),

  name: z
    .string({
      invalid_type_error: "Please provide name.",
      required_error: "Please provide name.",
    })
    .min(3, "Name must have atleast three characters"),
  role: z.enum(roles, {
    invalid_type_error: "Please provide role.",
    required_error: "Please provide role.",
  }),
});

const expenseItemSchemaa = z.object({
  date: z.coerce.date({
    required_error: "Date is required",
    invalid_type_error: "Invalid date",
  }),
  category: z.string().min(1, "Category is required"),
  expenseAccountId: z.string().min(1, "Expense account is required"),
  description: z
    .string()
    .min(3, "Description must be at least 3 characters")
    .max(200, "Description is too long"),
  amount: z.coerce
    .number({
      required_error: "Amount is required",
      invalid_type_error: "Amount must be a number",
    })
    .positive("Amount must be greater than zero"),
  notes: z.string().max(200).optional().or(z.literal("")),
  receipt: z
    .object({
      filename: z.string(),
      url: z.string().url(),
    })
    .optional(),
});

export const userUpdateForm = userForm.omit({ password: true });

export const validateNewUser = (userRawData) => userForm.safeParse(userRawData);
export const validateUpdateUser = (userRawData) =>
  userUpdateForm.safeParse(userRawData);

export const validateUpdateAccount = (userRawData) =>
  updateAccountForm.safeParse(userRawData);

export const validateAccount = (rawData) => accountForm.safeParse(rawData);


export const validateSettings = (rawData) => settingsForm.safeParse(rawData);
export const ValidateStock = (rawData) => stockForm.safeParse(rawData);
export const validateInvoice = (rawData) => invoiceForm.safeParse(rawData);
export const validateInvoiceItem = (rawData) =>
  invoiceItemForm.safeParse(rawData);
export const validateInvoiceUpdate = (rawData) =>
  updateInvoiceForm.safeParse(rawData);

export const validateInvoiceWithId = (rawData) =>
  updatedInvoiceWithIdSchema.safeParse(rawData);
export const validateDNote = (rawData) =>
  deliveryNoteZodSchema.safeParse(rawData);

export const validateAdvanceRequest = (rawData) =>
  advanceRequestSchema.safeParse(rawData);

export const validateReimbursement = (rawData) =>
  reimbursementSchema.safeParse(rawData);
