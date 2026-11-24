"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, KeyRound, Loader2, Plus, ShieldCheck, Trash2, Wifi } from "lucide-react";
import {
  setOfficeOnly,
  addOfficeNetwork,
  removeOfficeNetwork,
  issueRemoteToken,
  revokeRemoteToken,
} from "@/app/db/actions/remote-access-actions";

const when = (d) => (d ? new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export default function RemoteAccessBoard({ data }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [net, setNet] = useState("");
  const [netLabel, setNetLabel] = useState("");
  const [who, setWho] = useState("");
  const [days, setDays] = useState("30");
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState(null);

  function run(fn, ...args) {
    return new Promise((resolve) =>
      start(async () => {
        try {
          const r = await fn(...args);
          if (r?.success) {
            toast.success(r.message);
            router.refresh();
          } else toast.error(r?.error || "Something went wrong");
          resolve(r);
        } catch {
          toast.error("Could not reach the server. Reload and try again.");
          resolve(null);
        }
      }),
    );
  }

  const active = data.tokens.filter((t) => t.active);
  const past = data.tokens.filter((t) => !t.active);

  return (
    <div className="space-y-5">
      {/* The switch */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-5 w-5" /> Office-only access
              <Badge variant={data.officeOnly ? "default" : "outline"}>{data.officeOnly ? "On" : "Off"}</Badge>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.officeOnly
                ? "From outside the office addresses below, only people holding a valid token get in."
                : "QaliSuite works from anywhere. Add your office address, then switch this on."}
              {data.updatedByName ? ` Last changed by ${data.updatedByName}, ${when(data.updatedAt)}.` : ""}
            </p>
          </div>
          <Button
            variant={data.officeOnly ? "outline" : "default"}
            disabled={pending}
            onClick={() =>
              (data.officeOnly || confirm("Switch on office-only access? People away from the office will need a token.")) &&
              run(setOfficeOnly, !data.officeOnly)
            }
          >
            {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {data.officeOnly ? "Switch off" : "Switch on"}
          </Button>
        </div>
        <p className="mt-3 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          You are connecting from <b className="font-mono">{data.currentIp || "an unknown address"}</b>. Switching on is
          refused unless that address is listed or you hold a token, so you cannot lock yourself out.
        </p>
      </Card>

      {/* Office addresses */}
      <Card className="p-4 sm:p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Wifi className="h-5 w-5" /> Office addresses</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The office's public internet address, or a block of them (e.g. 41.90.12.0/24). Your internet provider can
          confirm it; from the office, &quot;Add this address&quot; uses the one you are on.
        </p>
        <div className="mt-3 space-y-2">
          {data.networks.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          {data.networks.map((n) => (
            <div key={n.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <div>
                <span className="font-mono text-sm">{n.network}</span>
                {n.label ? <span className="ml-2 text-sm text-muted-foreground">{n.label}</span> : null}
              </div>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm(`Remove ${n.network}?`) && run(removeOfficeNetwork, n.id)} aria-label={`Remove ${n.network}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
          <input className={input} placeholder="41.90.12.7 or 41.90.12.0/24" value={net} onChange={(e) => setNet(e.target.value)} />
          <input className={input} placeholder="Label (e.g. Nairobi HQ)" value={netLabel} onChange={(e) => setNetLabel(e.target.value)} />
          <Button disabled={pending || !net.trim()} onClick={async () => { const r = await run(addOfficeNetwork, net, netLabel); if (r?.success) { setNet(""); setNetLabel(""); } }}>
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
          {data.currentIp && (
            <Button variant="outline" disabled={pending} onClick={() => run(addOfficeNetwork, data.currentIp, "Added from this connection")}>
              Add this address
            </Button>
          )}
        </div>
      </Card>

      {/* Tokens */}
      <Card className="p-4 sm:p-5">
        <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-5 w-5" /> Remote-access tokens</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One per person, for this company. They enter it on the waiting page once and it stays on that device until it
          expires or you revoke it.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[2fr_1fr_2fr_auto]">
          <select className={input} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Person">
            <option value="">Choose a person…</option>
            {data.people.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.role}</option>)}
          </select>
          <select className={input} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Valid for">
            {[["1", "1 day"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["180", "6 months"], ["365", "1 year"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className={input} placeholder="Reason (e.g. site work in Mombasa)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button disabled={pending || !who} onClick={async () => { const r = await run(issueRemoteToken, who, Number(days), label); if (r?.token) { setIssued({ token: r.token, who: data.people.find((p) => p.id === who)?.name }); setLabel(""); } }}>
            Issue token
          </Button>
        </div>

        {issued && (
          <div className="mt-3 rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-3">
            <p className="text-sm font-semibold">Token for {issued.who} — copy it now, it is not shown again</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded bg-background px-2 py-1 font-mono text-base tracking-wider">{issued.token}</code>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(issued.token); toast.success("Copied"); }}>
                <Copy className="mr-1 h-4 w-4" /> Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>Done</Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Send it to them privately. Only a fingerprint of it is stored.</p>
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Person</th><th className="py-2 pr-3">Token</th><th className="py-2 pr-3">Expires</th>
                <th className="py-2 pr-3">Last used</th><th className="py-2 pr-3">Issued by</th><th />
              </tr>
            </thead>
            <tbody>
              {active.length === 0 && (
                <tr><td colSpan={6} className="py-3 text-muted-foreground">No active tokens.</td></tr>
              )}
              {active.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="py-2 pr-3">{t.userName}{t.label ? <div className="text-xs text-muted-foreground">{t.label}</div> : null}</td>
                  <td className="py-2 pr-3 font-mono">…{t.hint}</td>
                  <td className="py-2 pr-3">{when(t.expiresAt)}</td>
                  <td className="py-2 pr-3">{t.lastUsedAt ? <>{when(t.lastUsedAt)}<div className="font-mono text-xs text-muted-foreground">{t.lastUsedIp}</div></> : "Not yet"}</td>
                  <td className="py-2 pr-3">{t.createdByName}</td>
                  <td className="py-2 text-right">
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => confirm(`Revoke ${t.userName}'s token?`) && run(revokeRemoteToken, t.id)}>Revoke</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {past.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Expired and revoked ({past.length})</summary>
            <ul className="mt-2 space-y-1">
              {past.map((t) => (
                <li key={t.id} className="text-muted-foreground">
                  {t.userName} · …{t.hint} · {t.revokedAt ? `revoked by ${t.revokedByName} ${when(t.revokedAt)}` : `expired ${when(t.expiresAt)}`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </div>
  );
}
