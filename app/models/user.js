import mongoose from "mongoose";
import validator from "validator";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export const userRoles = [
  "SuperAdmin", // System-wide admin (manages all companies)
  "Admin", // Company-level admin
  "CEO", // Executive — read access across the business; no operational writes
  // Finance / accounting tiers (stacked top-down)
  "CFO", // Highest finance authority — large write-offs, price floor, policy
  "Finance Manager", // Mid-tier finance approvals, journal posting oversight
  "Accountant", // Posts JEs, reconciles, books variances
  // Sales / pricing
  "Sales Manager", // Sets selling prices, markups, discount caps
  // Procurement
  "Procurement Officer", // Raises POs, agrees cost prices with vendors
  // Operations
  "Manager", // Cross-functional operations
  "Store Manager", // Authorizes intra-store moves, supervises counts
  "Storekeeper", // Physical custody — receives, issues, counts. NO pricing access
  // Other
  "HR",
  "Technician",
  "Employee",
  "User", // Legacy generic — prefer Employee for new users
  "Viewer", // Read-only
];

const Schema = mongoose.Schema;

const userSchema = new Schema(
  {
    creator: {
      name: { required: true, type: String },
      id: { required: true, type: String },
    },
    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },
    // Session-revocation stamp. Admin actions that change a user's
    // privileges (role, status, companyId) or credentials (password)
    // bump this. Each issued JWT carries the version it was minted
    // with; a freshness check on privileged routes compares the two
    // and rejects mismatches. Lets us invalidate sessions without
    // waiting for the JWT's maxAge to expire.
    tokenVersion: {
      type: Number,
      default: 0,
      select: false,
    },
    name: {
      type: String,
      required: [true, "Please enter your name"],
      maxLength: [50, "Your name cannot exceed 50 characters"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Please enter your email"],
      unique: true,
      validate: [validator.isEmail, "Please enter valid email address"],
      trim: true,
      lowercase: true,
    },
    department: {
      type: String,

      trim: true,
    },
    password: {
      type: String,
      minLength: [6, "Your password must be longer than 6 characters"],
      select: false,
      // Not required — Google OAuth users don't have a password
    },
    role: {
      type: String,
      enum: userRoles,
      default: "User",
    },

    avatar: {
      type: String, // URL (e.g. Google profile picture)
      trim: true,
    },

    authProvider: {
      type: String,
      enum: ["credentials", "google"],
      default: "credentials",
    },

    // Multi-tenancy: Link user to a company
    // SuperAdmin users may have null companyId (system-wide access)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },

    // Back-reference to Party (set when employee invite is accepted or
    // when admin links a user to a party). Enables user.partyId lookups
    // without querying Party.findOne({ userId }).
    partyId: {
      type: Schema.Types.ObjectId,
      ref: "Party",
      sparse: true,
      index: true,
    },

    resetPasswordToken: String,
    resetPasswordExpire: Date,
  },
  { timestamps: true },
);

// Encrypting password before saving user
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) {
    return;
  }
  this.password = await bcrypt.hash(this.password, 10);
});

// Compare user password.
// Returns false (rather than throwing) when no password is set — e.g.,
// Google-signed-up users who never set a credentials password. Callers
// in the auth flow treat false as "invalid credentials" without
// distinguishing it from a wrong-password attempt, so we don't leak
// which accounts have a password and which don't.
userSchema.methods.comparePassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate password reset token
userSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(20).toString("hex");
  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");
  this.resetPasswordExpire = Date.now() + 30 * 60 * 1000;
  return resetToken;
};

// Static methods
userSchema.statics.findByEmail = async function (email) {
  return this.findOne({ email });
};

const models = mongoose.models;
let User = models?.User;

if (!User) {
  User = mongoose.model("User", userSchema);
}

export default User;
export { User };
