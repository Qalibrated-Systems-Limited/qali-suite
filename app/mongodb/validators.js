import { z } from "zod";

export const accountForm = z.object({
  name: z.string().max(100).min(4),
  address: z.string().max(100).min(4),

  phoneNumber: z.string().length(12),
  email: z.string().email().optional(),
});

export const invoiceItemForm = z.object({
  name: z.string().min(2).max(60),
  unit: z.string(),
  unitPrice: z.string().optional(),
  type: z.enum(["Stock", "Service"]),

  quantity: z.string(),
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
  stock: z.string(),
  description: z.string(),
});
export const invoiceForm = z.object({
  description: z.string().min(8).max(50),
  status: z.enum(["Paid", "Unpaid"]),
  customerId: z.string(),
  taxRate: z.string().min(2).max(2),
});

export const updateInvoiceForm = z.object({
  description: z.string().min(8).max(50),
  status: z.enum(["Paid", "Unpaid"]),
  customerId: z.string(),
  discount: z.string().min(1).max(2),
  taxRate: z.string().min(1).max(2),
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

export const stationForm = z.object({
  name: z.string().max(50).min(4),
  ipaddress: z.string().ip(),
  code: z.string().max(20).min(3),
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
  role: z.enum(["Admin", "Operator", "User"], {
    invalid_type_error: "Please provide role.",
    required_error: "Please provide role.",
  }),
});
export const userUpdateForm = userForm.omit({ password: true });

export const validateNewUser = (userRawData) => userForm.safeParse(userRawData);
export const validateUpdateUser = (userRawData) =>
  userUpdateForm.safeParse(userRawData);

export const validateUpdateAccount = (userRawData) =>
  updateAccountForm.safeParse(userRawData);

export const validateAccount = (rawData) => accountForm.safeParse(rawData);

export const validateStation = (rawData) => stationForm.safeParse(rawData);

export const validateSettings = (rawData) => settingsForm.safeParse(rawData);
export const ValidateStock = (rawData) => stockForm.safeParse(rawData);
export const validateInvoice = (rawData) => invoiceForm.safeParse(rawData);
export const validateInvoiceItem = (rawData) =>
  invoiceItemForm.safeParse(rawData);

export const validateInvoiceUpdate = (rawData) =>
  updateInvoiceForm.safeParse(rawData);

export const validateInvoiceWithId = (rawData) =>
  updatedInvoiceWithIdSchema.safeParse(rawData);
