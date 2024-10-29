import mongoose from "mongoose";
import validator from "validator";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { NextResponse } from "next/server";

const Schema = mongoose.Schema;

const userSchema =
  Schema &&
  new Schema(
    {
      creator: {
        name: { required: true, type: String },
        id: { required: true, type: String },
      },
      status: {
        type: String,
        default: "Active",
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

      password: {
        type: String,
        required: [true, "Please enter your password"],
        minLength: [6, "Your password must be longer than 6 characters"],
        select: false,
      },

      role: {
        type: String,
        default: "user",
      },

      resetPasswordToken: String,
      resetPasswordExpire: Date,
    },
    { timestamps: true }
  );

// Encrypting password before saving user

userSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    NextResponse.next();
  }

  this.password = await bcrypt.hash(this.password, 10);
});

// Compare user password
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate password reset token
userSchema.methods.getResetPasswordToken = function () {
  // Generate token
  const resetToken = crypto.randomBytes(20).toString("hex");

  // Hash and set to resetPasswordToken field
  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  // Set token expire time
  this.resetPasswordExpire = Date.now() + 30 * 60 * 1000;

  return resetToken;
};

userSchema.statics.findByEmail = async function (email) {
  return this.findOne({ email });
};

userSchema.statics.upadetePassword = async function (password, email) {
  const user = await this.findByEmail(email);
  let result;
  if (user) {
    user.password = password;

    result = await user.save();
  }

  return result;
};
userSchema.statics.insertUser = async function (
  name,
  email,
  password,
  creator,
  role
) {
  const user = new this({
    name,
    email,
    password,
    creator,
    role,
  });
  await user.save();
  return {
    userId: user._id,
    email: user.email,
    role: user.role,
    userName: user.name,
  };
};

userSchema.statics.updateUser = async function (
  name,
  email,

  role,
  user
) {
  let result;

  if (user) {
    user.role = role;
    user.name = name;
    result = await user.save();
  }

  return result;
};

const models = mongoose.models;
let User = models ? models.User : null;
if (User) {
  User = User;
} else {
  User = mongoose.model("User", userSchema);
}

export default User;
