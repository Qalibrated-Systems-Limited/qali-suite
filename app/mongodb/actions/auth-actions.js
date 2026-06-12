"use server";

import { signOut } from "@/auth";

// Sign the user out and land on the public home page. Lives in the modern
// actions tree; the legacy app/mongodb/actions.js wrapper this replaces is
// deleted.
export async function logout() {
  return await signOut({ redirectTo: "/" });
}
