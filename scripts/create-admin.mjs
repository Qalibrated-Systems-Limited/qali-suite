#!/usr/bin/env node
// ============================================
// CREATE THE FIRST ADMIN — DEVELOPMENT CONVENIENCE
// ============================================
// There is no public signup route: createCompany (app/mongodb/actions/
// company-actions.js) requires an existing logged-in SuperAdmin, which is a
// chicken-and-egg problem on a fresh database. This writes a SuperAdmin
// login directly into Mongo — still the writer of record for logins per
// app/db/userAdmin.ts — matching the shape scripts/backfill-users-to-pg.mjs
// expects (name, email, password, role, status, creator, tokenVersion,
// authProvider). Run the backfill script right after this one to mirror the
// login into Postgres, since findUserForSignIn (auth.ts) reads Postgres.
//
// Usage:
//   node --env-file=.env scripts/create-admin.mjs <email> <password> ["Full Name"]
// ============================================

import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set — see .env.example");
  process.exit(1);
}

const [, , email, password, name = "Admin"] = process.argv;
if (!email || !password) {
  console.error(
    'Usage: node --env-file=.env scripts/create-admin.mjs <email> <password> ["Full Name"]',
  );
  process.exit(1);
}
if (password.length < 6) {
  console.error("Password must be at least 6 characters (matches the app's own rule).");
  process.exit(1);
}

await mongoose.connect(MONGODB_URI);

try {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await mongoose.connection
    .collection("users")
    .findOne({ email: normalizedEmail });

  if (existing) {
    console.log(`A user with email ${normalizedEmail} already exists (id ${existing._id}).`);
    console.log("Nothing written. Run scripts/backfill-users-to-pg.mjs if it's missing from Postgres.");
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const doc = {
    name,
    email: normalizedEmail,
    password: passwordHash,
    role: "SuperAdmin",
    status: "Active",
    authProvider: "credentials",
    tokenVersion: 0,
    creator: { id: "bootstrap-script", name: "Bootstrap script" },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await mongoose.connection.collection("users").insertOne(doc);
  console.log(`Created SuperAdmin ${normalizedEmail} (Mongo id ${result.insertedId})`);
  console.log("\nNext steps:");
  console.log("  1. node --env-file=.env scripts/backfill-users-to-pg.mjs");
  console.log('  2. node --env-file=.env scripts/provision-tenant.mjs "Your Company Name"');
  console.log("  3. Restart npm run dev and log in with this email/password.");
} finally {
  await mongoose.disconnect();
}
