"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck, UserPlus, UserMinus, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getCompanyMembers,
  searchGrantableUsers,
  grantCompanyAccessAction,
  revokeCompanyAccessAction,
} from "@/app/db/actions/company-access-actions";

/**
 * Who may operate in this company.
 *
 * The grants are what the tenant gate reads on every request, so this is not
 * a summary of access — it IS access. Suspended rows stay on the list because
 * "removed in March" is a question somebody will ask, and a list that hides
 * them cannot answer it.
 */
export default function CompanyAccessCard({ companyId, companyName }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    try {
      setMembers(await getCompanyMembers(companyId));
    } catch (err) {
      toast.error(err?.message ?? "Could not read company access.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // companyId is the page's own param and does not change under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  function search() {
    setSearching(true);
    startTransition(async () => {
      try {
        setCandidates(await searchGrantableUsers(term));
      } catch (err) {
        toast.error(err?.message ?? "Could not search users.");
      } finally {
        setSearching(false);
      }
    });
  }

  function grant(userId, name) {
    startTransition(async () => {
      const result = await grantCompanyAccessAction({
        sourceCompanyId: companyId,
        userId,
      });
      if (!result?.ok) return toast.error(result?.error ?? "Could not grant access.");
      toast.success(`${name} can now operate in ${companyName}.`);
      setCandidates([]);
      setTerm("");
      await refresh();
    });
  }

  function revoke(userId, name) {
    startTransition(async () => {
      const result = await revokeCompanyAccessAction({
        sourceCompanyId: companyId,
        userId,
      });
      if (!result?.ok) return toast.error(result?.error ?? "Could not revoke access.");
      // The gate re-reads the grants every request, so this is in force now
      // rather than whenever their session happens to refresh.
      toast.success(`${name} can no longer open ${companyName}.`);
      await refresh();
    });
  }

  const active = members.filter((m) => m.status === "active");
  const alreadyIn = new Set(active.map((m) => m.userId));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Company access
          <Badge variant="outline" className="ml-1 font-normal">
            {active.length} active
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Who may switch into this company. Checked on every request — a
          suspension takes effect immediately, without waiting for the person
          to sign in again. Platform staff (SuperAdmin) hold standing access
          to every company; remove the role to remove the access.
        </p>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Add somebody */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={term}
              placeholder="Find a user by name or email"
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
            />
            <Button
              type="button"
              variant="outline"
              onClick={search}
              disabled={searching || isPending}
            >
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              <span className="ml-2 hidden sm:inline">Search</span>
            </Button>
          </div>

          {candidates.length > 0 && (
            <div className="rounded-md border border-border divide-y divide-border">
              {candidates.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{u.name || u.email}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {u.email}
                      {u.role ? ` · ${u.role}` : ""}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending || alreadyIn.has(u.id)}
                    onClick={() => grant(u.id, u.name || u.email)}
                  >
                    <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                    {alreadyIn.has(u.id) ? "Already in" : "Grant"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Who is in */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading access…
          </div>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody has been granted access yet. The first person to open this
            company from their own account is granted it automatically.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role here</TableHead>
                  <TableHead>Granted</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.userId} className={m.status !== "active" ? "opacity-60" : ""}>
                    <TableCell>
                      <div className="font-medium">
                        {m.name ?? `Unknown user (${m.userId.slice(-6)})`}
                      </div>
                      <div className="text-xs text-muted-foreground">{m.email ?? "—"}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {/* Null means the grant carries no role of its own, so
                          the user's global role applies — which is what every
                          grant carried over from the single-company model
                          says. */}
                      {m.role ?? (
                        <span className="text-muted-foreground">
                          {m.globalRole ?? "—"} (global)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.grantedVia}
                      {m.grantedByName ? ` · ${m.grantedByName}` : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="outline"
                        className={
                          m.status === "active"
                            ? "bg-green-500/10 text-green-600 border-green-500/20"
                            : "bg-gray-500/10 text-gray-600 border-gray-500/20"
                        }
                      >
                        {m.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {/* PLATFORM STAFF HOLD STANDING ACCESS. Revoking one
                          here is undone the next time they are refused a
                          company, so the button would lie. Taking the
                          SuperAdmin role away is the control. */}
                      {m.grantedVia === "superadmin" ? (
                        <span className="text-xs text-muted-foreground">
                          Platform staff
                        </span>
                      ) : m.status === "active" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => revoke(m.userId, m.name ?? "That user")}
                        >
                          <UserMinus className="h-3.5 w-3.5 mr-1.5" />
                          Revoke
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => grant(m.userId, m.name ?? "That user")}
                        >
                          <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                          Restore
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
