"use server";

import { signOut } from "@/auth";

// Sign the user out and land on the public home page.
//
// MOVED OUT OF app/mongodb/ (it never had any Mongo in it — it calls NextAuth
// and nothing else). It was filed there by history, and two screens imported
// it from `@/app/mongodb/...`, which is the string the port's progress metric
// counts. Two files were reading as unported because of where this one sat.
export async function logout() {
  return await signOut({ redirectTo: "/" });
}
