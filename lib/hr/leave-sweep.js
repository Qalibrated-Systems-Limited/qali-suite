import LeaveRequest from "@/app/models/leaveRequest";
import EmployeeProfile from "@/app/models/employeeProfile";

// ============================================
// LEAVE COMPLETION SWEEP
// ============================================
// Self-healing job for two related drifts that would otherwise need a cron:
//   1. Approved leaves whose `dates.to` is in the past should be `completed`
//      (their balance was already debited at approval time — only the
//      status transitions).
//   2. Employees whose `employment.status` is "on_leave" with no currently
//      overlapping approved leave should be restored to "active".
//
// Called from `getLeaveRequests` so the leave page is the recurring trigger.
// Safe to call concurrently — both updates are idempotent and tenant-scoped.
// ============================================
export async function sweepCompletedLeaves(companyId) {
  if (!companyId) return { completed: 0, restored: 0 };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    // 1) Mark expired approved leaves as completed.
    //    Aggregation pipeline so each row's own dates.to becomes its
    //    completedAt (one round-trip, accurate timestamps). Mongoose 8
    //    requires explicit opt-in for pipeline updates via the
    //    `updatePipeline` option — without it, the array is rejected.
    const completedResult = await LeaveRequest.updateMany(
      {
        companyId,
        status: "approved",
        "dates.to": { $lt: today },
      },
      [
        {
          $set: {
            status: "completed",
            completedAt: "$dates.to",
          },
        },
      ],
      { updatePipeline: true },
    );

    // 2) Restore employees stuck on "on_leave" when no active leave overlaps today.
    const onLeaveProfiles = await EmployeeProfile.find({
      companyId,
      "employment.status": "on_leave",
    })
      .select("_id")
      .lean();

    let restored = 0;
    if (onLeaveProfiles.length > 0) {
      const profileIds = onLeaveProfiles.map((p) => p._id);

      // Profiles that genuinely still have a current approved leave today.
      const stillOnLeaveIds = await LeaveRequest.distinct(
        "employee.profileId",
        {
          companyId,
          "employee.profileId": { $in: profileIds },
          status: "approved",
          "dates.from": { $lte: today },
          "dates.to": { $gte: today },
        }
      );

      const stillSet = new Set(stillOnLeaveIds.map((id) => id.toString()));
      const toRestore = profileIds.filter((id) => !stillSet.has(id.toString()));

      if (toRestore.length > 0) {
        const restoreResult = await EmployeeProfile.updateMany(
          { _id: { $in: toRestore } },
          { $set: { "employment.status": "active" } }
        );
        restored = restoreResult.modifiedCount || 0;
      }
    }

    return {
      completed: completedResult.modifiedCount || 0,
      restored,
    };
  } catch (err) {
    // Best-effort sweep — log but never break the calling page.
    console.error("[sweepCompletedLeaves] failed:", err.message);
    return { completed: 0, restored: 0 };
  }
}
