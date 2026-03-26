import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { seedDefaultPlans } from "@/lib/plans-server";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "SuperAdmin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await seedDefaultPlans();
  return NextResponse.json(result);
}
