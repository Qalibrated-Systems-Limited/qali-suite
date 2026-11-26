"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Send, BellRing } from "lucide-react";
import { sendTestEmail, sendTestPush } from "@/app/db/actions/notification-setup-actions";

function Row({ ok, warn, label, children }) {
  const Icon = ok ? CheckCircle2 : warn ? AlertTriangle : XCircle;
  const tone = ok ? "text-emerald-600 dark:text-emerald-400" : warn ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
  return (
    <li className="flex gap-3 px-4 py-3">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
      <div className="min-w-0 text-sm">
        <p className="font-medium">{label}</p>
        <div className="text-xs text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function Result({ r }) {
  if (!r) return null;
  return (
    <p className={`mt-2 rounded-md px-3 py-2 text-xs ${r.success ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-700 dark:text-red-400"}`}>
      {r.success ? r.message : r.error}
    </p>
  );
}

const code = "rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground";

export default function NotificationSetupBoard({ setup }) {
  const { email, push } = setup;
  const [to, setTo] = useState(setup.myEmail);
  const [emailResult, setEmailResult] = useState(null);
  const [pushResult, setPushResult] = useState(null);
  const [busyEmail, startEmail] = useTransition();
  const [busyPush, startPush] = useTransition();

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="border-b border-border bg-muted/30 px-4 py-3">
          <h2 className="text-sm font-semibold">Email — invitations, approvals, supplier notices</h2>
        </header>
        <ul className="divide-y divide-border">
          {email.transport === "smtp" ? (
            <Row ok={email.smtpOk} label={`Sending through your mail server: ${email.smtpHost}`}>
              {email.smtpOk ? (
                <>The mail server accepted the login for {email.smtpUser || "(no user)"}.</>
              ) : (
                <>
                  The mail server refused the connection or login: <strong>{email.smtpError || "unknown error"}</strong>. Check
                  SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD in the server’s settings file.
                </>
              )}
            </Row>
          ) : (
            <Row ok={email.hasKey} label={email.hasKey ? "Sending through Resend" : "No way to send email is set up"}>
              {email.hasKey ? (
                <>RESEND_API_KEY is set. To send from your own mailbox instead, set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD.</>
              ) : (
                <>
                  Nothing can be emailed. Either use your own mailbox (<span className={code}>SMTP_HOST</span>,{" "}
                  <span className={code}>SMTP_PORT</span>, <span className={code}>SMTP_USER</span>,{" "}
                  <span className={code}>SMTP_PASSWORD</span>) or a Resend key (<span className={code}>RESEND_API_KEY</span>), then redeploy.
                </>
              )}
            </Row>
          )}
          <Row ok={email.transport === "smtp" || !email.sandboxSender} warn={email.transport !== "smtp" && email.sandboxSender} label={`Sender: ${email.from}`}>
            {email.transport === "smtp" ? (
              <>Must be the mailbox you log in with ({email.smtpUser || "SMTP_USER"}), or one it may send as, or the mail server refuses it.</>
            ) : email.sandboxSender ? (
              <>
                This is Resend’s test sender. It only delivers to the email address that owns the Resend account. Verify your
                domain at resend.com → Domains, then set <span className={code}>FROM_EMAIL=QaliSuite &lt;noreply@yourdomain.com&gt;</span>.
              </>
            ) : (
              <>The sender’s domain must be verified at resend.com → Domains, or Resend refuses it.</>
            )}
          </Row>
          <Row ok={!email.appUrlLooksWrong} label={`Links in emails go to: ${email.appUrl || "(not set)"}`}>
            {email.appUrlLooksWrong ? (
              <>
                Invitation links would point at the wrong place. Set <span className={code}>APP_URL=https://your-site</span>{" "}
                and redeploy.
              </>
            ) : (
              <>Invitation and notification links open this address.</>
            )}
          </Row>
        </ul>
        <div className="border-t border-border p-4">
          <p className="mb-2 text-xs text-muted-foreground">Send a real test email — the result shows exactly what the email service said.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="name@company.com"
              aria-label="Send test email to"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={busyEmail}
              onClick={() => startEmail(async () => setEmailResult(await sendTestEmail(to)))}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {busyEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test email
            </button>
          </div>
          <Result r={emailResult} />
          <p className="mt-3 text-xs text-muted-foreground">
            Once it works, resend pending invitations from Users &amp; Access → Invitations.
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="border-b border-border bg-muted/30 px-4 py-3">
          <h2 className="text-sm font-semibold">Push notifications — phones and browsers</h2>
        </header>
        <ul className="divide-y divide-border">
          <Row ok={push.configured} label={push.configured ? "Push is set up on the server" : "Push is not set up yet"}>
            {push.configured ? (
              <>Every bell notification is also pushed to the person’s devices.</>
            ) : (
              <>
                On the server run <span className={code}>npx web-push generate-vapid-keys</span> once, then add to the
                settings file <span className={code}>VAPID_PUBLIC_KEY=…</span>, <span className={code}>VAPID_PRIVATE_KEY=…</span> and{" "}
                <span className={code}>VAPID_SUBJECT=mailto:you@yourdomain.com</span>, and redeploy. Keep the private key
                secret; never change the keys afterwards, or every device must turn notifications on again.
              </>
            )}
          </Row>
          <Row ok={push.devices > 0} warn={push.devices === 0} label={`${push.devices} device${push.devices === 1 ? "" : "s"} turned on, for ${push.people} ${push.people === 1 ? "person" : "people"}`}>
            Each person turns it on from the bell (top right) → “Notify me on this device”. On iPhone, add QaliSuite to the Home
            Screen first (Share → Add to Home Screen), then turn it on from there. The site must be on https.
          </Row>
        </ul>
        <div className="border-t border-border p-4">
          <button
            type="button"
            disabled={busyPush}
            onClick={() => startPush(async () => setPushResult(await sendTestPush()))}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {busyPush ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />} Send a test push to my devices
            {push.mine ? ` (${push.mine})` : ""}
          </button>
          <Result r={pushResult} />
        </div>
      </section>
    </div>
  );
}
