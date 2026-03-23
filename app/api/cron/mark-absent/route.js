import { NextResponse } from "next/server";
import dbConnect from "@/app/config/dbConnect";
import Attendance from "@/app/models/attendance";
import EmployeeProfile from "@/app/models/employeeProfile";
import Company from "@/app/models/Company";

// ============================================
// CRON: AUTO-MARK ABSENT
// ============================================
// Called once daily after shift end time.
// Marks any active employee with no attendance record for today as "absent".
//
// Protection: Authorization header must match CRON_SECRET env var.
// Vercel Cron passes this automatically when configured in vercel.json.
// External cron services (Railway, cron-job.org) must set the header manually.
// ============================================

function toDateKey(d) {
  const dt = new Date(d);
  dt.setUTCHours(0, 0, 0, 0);
  return dt;
}

export async function GET(request) {
  // ── Auth check ──────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await dbConnect();

    const dateKey = toDateKey(new Date());

    // Get all non-SuperAdmin companies
    const companies = await Company.find({}).select("_id name").lean();

    const results = [];

    for (const company of companies) {
      const companyId = company._id;

      // Active employees for this company
      const employees = await EmployeeProfile.find({
        companyId,
        "employment.status": { $in: ["active", "probation"] },
      })
        .select("_id partyId personalInfo employeeNumber employment companyId")
        .lean();

      if (!employees.length) continue;

      // Who already has a record today?
      const existing = await Attendance.find({ companyId, date: dateKey })
        .select("profileId")
        .lean();

      const existingIds = new Set(existing.map((r) => r.profileId.toString()));

      const toCreate = employees
        .filter((p) => !existingIds.has(p._id.toString()))
        .map((p) => ({
          companyId: p.companyId,
          profileId: p._id,
          partyId: p.partyId,
          employeeName: `${p.personalInfo?.firstName || ""} ${p.personalInfo?.lastName || ""}`.trim(),
          employeeNumber: p.employeeNumber,
          department: p.employment?.department || "",
          date: dateKey,
          status: "absent",
          method: "auto",
          markedAbsentAt: new Date(),
        }));

      if (toCreate.length) {
        await Attendance.insertMany(toCreate, { ordered: false });
      }

      results.push({ company: company.name, marked: toCreate.length, total: employees.length });
    }

    const totalMarked = results.reduce((s, r) => s + r.marked, 0);
    console.log(`[cron/mark-absent] ${new Date().toISOString()} — marked ${totalMarked} absent across ${companies.length} companies`);

    return NextResponse.json({ ok: true, date: dateKey, results });
  } catch (error) {
    console.error("[cron/mark-absent] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
