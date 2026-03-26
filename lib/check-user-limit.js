import dbConnect from "@/app/config/dbConnect";
import User from "@/app/models/user";
import Company from "@/app/models/Company";

export async function checkUserLimit(companyId) {
  if (!companyId) return { allowed: true };
  await dbConnect();

  const [company, activeUserCount] = await Promise.all([
    Company.findById(companyId).select("subscription.maxUsers subscription.plan").lean(),
    User.countDocuments({ companyId, status: { $ne: "Inactive" } }),
  ]);

  if (!company) return { allowed: false, error: "Company not found" };

  const maxUsers = company.subscription?.maxUsers ?? 5;
  if (maxUsers === -1) return { allowed: true }; // unlimited (enterprise)

  if (activeUserCount >= maxUsers) {
    return {
      allowed: false,
      error: `User limit reached (${activeUserCount}/${maxUsers}). Upgrade your plan to add more users.`,
      currentCount: activeUserCount,
      maxUsers,
    };
  }
  return { allowed: true, currentCount: activeUserCount, maxUsers };
}
