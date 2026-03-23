import mongoose from "mongoose";
import crypto from "crypto";
import { userRoles } from "./user";

const Schema = mongoose.Schema;

const inviteSchema = new Schema(
  {
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
    },

    role: {
      type: String,
      enum: userRoles,
      required: [true, "Role is required"],
      default: "User",
    },

    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company is required"],
      index: true,
    },

    invitedBy: {
      name: { type: String, required: true },
      id: { type: String, required: true },
    },

    // For employee portal invites — links this invite to a specific Party record.
    // When the invite is accepted, User.id is written back to Party.userId
    // and EmployeeProfile.userId, completing the login connection.
    // null = general user invite (not an employee portal invite)
    partyId: {
      type: Schema.Types.ObjectId,
      ref: "Party",
      default: null,
    },

    // Store hashed token — raw token is sent in the email link
    token: {
      type: String,
      required: true,
      unique: true,
    },

    status: {
      type: String,
      enum: ["pending", "accepted", "cancelled"],
      default: "pending",
    },

    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },

    acceptedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Indexes
inviteSchema.index({ token: 1, status: 1 });
inviteSchema.index({ companyId: 1, status: 1 });
inviteSchema.index({ email: 1, companyId: 1, status: 1 });

// Static: generate a token pair (raw for email, hashed for DB)
inviteSchema.statics.generateToken = function () {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");
  return { rawToken, hashedToken };
};

// Static: find a valid invite by raw token
inviteSchema.statics.findByToken = function (rawToken) {
  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");
  return this.findOne({
    token: hashedToken,
    status: "pending",
    expiresAt: { $gt: new Date() },
  });
};

const models = mongoose.models;
let Invite = models?.Invite;

if (!Invite) {
  Invite = mongoose.model("Invite", inviteSchema);
}

export default Invite;
export { Invite };
