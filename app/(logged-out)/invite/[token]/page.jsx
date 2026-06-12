import { getInviteByToken } from "@/app/mongodb/actions/invite-actions";
import AcceptInviteClient from "./AcceptInviteClient";
import { AlertCircle, Clock, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { QaliSuiteMark } from "@/components/qalisuite-logo";

export async function generateMetadata({ params }) {
  const { token } = await params;
  const result = await getInviteByToken(token);

  if (!result.valid) {
    return { title: "Invalid Invite | QaliSuite" };
  }

  return {
    title: `Join ${result.invite.companyName} | QaliSuite`,
    description: `Accept your invitation to join ${result.invite.companyName}`,
  };
}

export default async function InvitePage({ params }) {
  const { token } = await params;
  const result = await getInviteByToken(token);

  if (!result.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="flex justify-center">
            <QaliSuiteMark size="lg" />
          </div>

          {/* Error Card */}
          <div className="rounded-xl border bg-card p-8 space-y-4">
            <div className="mx-auto w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertCircle className="h-7 w-7 text-red-500" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              Invite Unavailable
            </h2>
            <p className="text-sm text-muted-foreground">{result.error}</p>
            <Button asChild className="mt-4">
              <Link href="/login">Go to Login</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 py-6">
      <div className="w-full max-w-md space-y-4 sm:space-y-6">
        <div className="flex justify-center">
          <QaliSuiteMark size="lg" subtitle="ERP System" />
        </div>

        {/* Invite Info — compact on phones: this page stacks two cards, so
            every saved row matters */}
        <div className="rounded-xl border bg-card p-4 sm:p-6 space-y-3 sm:space-y-4 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 sm:h-14 sm:w-14">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 sm:h-7 sm:w-7" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">
              You&apos;re invited!
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              <strong>{result.invite.invitedBy}</strong> invited you to join{" "}
              <strong>{result.invite.companyName}</strong> as{" "}
              <strong>{result.invite.role}</strong>
            </p>
          </div>
          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>
              Expires{" "}
              {new Date(result.invite.expiresAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </div>

        {/* Accept Form */}
        <AcceptInviteClient
          token={token}
          email={result.invite.email}
          companyName={result.invite.companyName}
        />
      </div>
    </div>
  );
}
