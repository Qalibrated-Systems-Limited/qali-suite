import { z } from "zod";

export const updateAccountForm = z.object({
  name: z.string().max(100).min(4),

  status: z.enum(["Active", "Inactive"], {
    invalid_type_error: "Status should be either Active or Inactive.",
    required_error: "Status should be either Active or Inactive.",
  }),

  accountType: z.enum(["Driver", "Customer"], {
    invalid_type_error: "Type should be Customer or Driver.",
    required_error: "Type is either Customer or Driver.",
  }),
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

export const accountForm = z.object({
  name: z.string().max(100).min(4),
  accountType: z.string().max(10).min(4),
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
