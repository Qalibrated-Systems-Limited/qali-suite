import dbConnect from "@/app/config/dbConnect";
import User from "@/app/models/user";
import Company from "@/app/models/Company";

/**
 * Check whether a company can add another user.
 * @param {string} companyId
 * @param {object} [options]
 * @param {boolean} [options.bypass] - skip enforcement (e.g. SuperAdmin acting on behalf of a tenant)
 */
export async function checkUserLimit(companyId, options = {}) {
  if (options.bypass) return { allowed: true, bypassed: true };
  if (!companyId) return { allowed: true };
  await dbConnect();

  const [company, activeUserCount] = await Promise.all([
    Company.findById(companyId).select("subscription.maxUsers subscription.plan").lean(),
    User.countDocuments({ companyId, status: { $ne: "Inactive" } }),
  ]);

  if (!company) return { allowed: false, error: "Company not found" };

  const maxUsers = company.subscription?.maxUsers ?? 2;
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
