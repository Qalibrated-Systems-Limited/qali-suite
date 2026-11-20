"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { assignTicket, setTicketStatus } from "@/app/db/actions/helpdesk-actions";

const PRIORITY = { critical: "red", high: "amber", medium: "blue", low: "slate" };
const STATUS = {
  new: "New", assigned: "Assigned", in_progress: "In progress", pending: "Pending",
  escalated: "Escalated", reopened: "Reopened",
};

export default function TicketsTable({ tickets, team, me }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState(me.isManager ? "" : "mine");
  const shown = tickets.filter((t) =>
    filter === "mine" ? t.assignedToUserId === me.userId : filter === "unassigned" ? !t.assignedToUserId : true,
  );

  function run(fn, ...args) {
    startTransition(async () => {
      try {
        const res = await fn(...args);
        if (res?.success) {
          toast.success(res.message);
          router.refresh();
        } else toast.error(res?.error || "Something went wrong");
      } catch {
        toast.error("Could not reach the server. Reload the page and try again.");
      }
    });
  }

  const chip = (id, label, n) => (
    <button key={id || "all"} type="button" className={`tech-tab ${filter === id ? "on" : ""}`} onClick={() => setFilter(id)}>
      {label} ({n})
    </button>
  );

  return (
    <>
      <div className="tech-tabs" style={{ marginTop: 14 }}>
        {chip("", "All open", tickets.length)}
        {chip("unassigned", "Unassigned", tickets.filter((t) => !t.assignedToUserId).length)}
        {chip("mine", "Mine", tickets.filter((t) => t.assignedToUserId === me.userId).length)}
      </div>
      {shown.length === 0 ? (
        <div className="tech-empty2">No tickets here.</div>
      ) : (
        <div className="tech-tablewrap">
          <table className="tech-table">
            <thead>
              <tr><th>Ticket</th><th>Client</th><th>Priority</th><th>Resolve by</th><th>Status</th><th>Technician</th><th></th></tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const mine = t.assignedToUserId === me.userId;
                return (
                  <tr key={t.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{t.title}</div>
                      <div className="mono" style={{ fontSize: 11 }}>{t.ticketNumber}{t.categoryName ? ` · ${t.categoryName}` : ""}</div>
                    </td>
                    <td>{t.customerName || "—"}</td>
                    <td><span className={`tech-b ${PRIORITY[t.priority] || "slate"}`}>{t.priority}</span></td>
                    <td style={t.breached ? { color: "#b91c1c", fontWeight: 700 } : undefined}>
                      {t.resolutionDueAt ? new Date(t.resolutionDueAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—"}
                      {t.breached ? " · SLA breached" : ""}
                    </td>
                    <td>
                      {mine && ["assigned", "in_progress", "pending"].includes(t.status) ? (
                        <select className="tech-rowbtn" value={t.status} disabled={pending} onChange={(e) => run(setTicketStatus, t.id, e.target.value)}>
                          <option value="assigned">Assigned</option>
                          <option value="in_progress">In progress</option>
                          <option value="pending">Pending</option>
                        </select>
                      ) : (
                        <span className="tech-b blue">{STATUS[t.status] || t.status}</span>
                      )}
                    </td>
                    <td>
                      {me.isManager ? (
                        <select
                          className="tech-rowbtn"
                          aria-label={`Assign ${t.ticketNumber}`}
                          value={t.assignedToUserId || ""}
                          disabled={pending}
                          onChange={(e) => run(assignTicket, t.id, e.target.value || null, "")}
                        >
                          <option value="">Unassigned</option>
                          {t.assignedToUserId && !team.some((p) => p.id === t.assignedToUserId) && (
                            <option value={t.assignedToUserId}>{t.assigneeName}</option>
                          )}
                          {team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      ) : (
                        t.assigneeName || "Unassigned"
                      )}
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        {mine && (
                          <button
                            className="tech-rowbtn"
                            disabled={pending}
                            onClick={() => {
                              const notes = prompt(`Resolve ${t.ticketNumber} — what was done?`);
                              if (notes && notes.trim()) run(setTicketStatus, t.id, "resolved", { resolutionNotes: notes });
                            }}
                          >
                            Resolve
                          </button>
                        )}
                        <Link className="tech-rowbtn" href={`/dashboard/helpdesk?ticket=${t.id}`}>Open</Link>
                        {pending && <Loader2 size={14} className="animate-spin" />}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
