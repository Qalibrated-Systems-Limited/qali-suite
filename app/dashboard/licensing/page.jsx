import { auth } from "@/auth";
import { redirect } from "next/navigation";
import LicensingBoard from "./LicensingBoard";
import { getLicensingData } from "@/app/db/actions/licensing-actions";
import { hasRole, LICENSING_WRITE_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Licensing | QaliSuite",
  description:
    "Issue, validate, revoke and renew ES256 license keys for the QaliTrack product line.",
};

// Auth-gated (session headers) — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function LicensingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getLicensingData();
  const canManage = hasRole(session.user, LICENSING_WRITE_ROLES);

  return (
    <div style={{ padding: "clamp(16px, 2.4vw, 26px)" }}>
      <LicensingBoard
        licenses={data.licenses}
        stats={data.stats}
        catalogue={data.catalogue}
        signingKeyConfigured={data.signingKeyConfigured}
        canManage={canManage}
      />
    </div>
  );
}
