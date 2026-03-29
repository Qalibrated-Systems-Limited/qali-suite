import Link from "next/link";
import { ChevronLeft, Globe } from "lucide-react";
import { getWebhookSubscriptions } from "@/app/mongodb/actions/integration-actions";
import CreateWebhookForm from "./components/CreateWebhookForm";
import WebhookCard from "./components/WebhookCard";

export const metadata = { title: "Webhooks | Integrations" };

export default async function WebhooksPage() {
  const webhooks = await getWebhookSubscriptions();

  const suspended = webhooks.filter((w) => w.suspended);

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/integrations" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Integrations
        </Link>
        <span>/</span>
        <span className="text-foreground">Webhooks</span>
      </div>

      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Webhooks</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Push real-time events to external systems when something happens in QaliSuite.
          Each delivery is HMAC-signed so your endpoint can verify authenticity.
        </p>
      </div>

      {/* Suspended alert */}
      {suspended.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
          {suspended.length} webhook{suspended.length > 1 ? "s are" : " is"} suspended due to delivery failures.
          Fix the endpoint and click <strong>Resume deliveries</strong>.
        </div>
      )}

      {/* Create form */}
      <CreateWebhookForm />

      {/* Webhook list */}
      {webhooks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <Globe className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No webhooks registered yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Register an endpoint above to start receiving real-time events.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {webhooks.length} Webhook{webhooks.length !== 1 ? "s" : ""}
          </h2>
          {webhooks.map((webhook) => (
            <WebhookCard key={webhook._id} webhook={webhook} />
          ))}
        </div>
      )}

      {/* Verification guide */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-foreground text-sm">Verifying deliveries on your endpoint</p>
        <p>Every POST includes a <code className="font-mono bg-muted px-1 rounded">X-QaliSuite-Signature</code> header.</p>
        <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{`// Node.js example
const sig = req.headers['x-qalisuite-signature'];
const expected = 'sha256=' +
  crypto.createHmac('sha256', YOUR_SECRET)
        .update(rawBody)
        .digest('hex');
if (sig !== expected) return res.status(401).end();`}</pre>
        <p>Use the signing secret shown once at creation. Store it as an environment variable.</p>
      </div>
    </div>
  );
}
