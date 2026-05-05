import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ApproverAssignDialog } from "@/components/sis/approver-assign-dialog";
import { ApproverRevokeButton } from "@/components/sis/approver-revoke-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  APPROVER_FLOWS,
  APPROVER_FLOW_DESCRIPTIONS,
  APPROVER_FLOW_LABELS,
  type ApproverFlow,
} from "@/lib/schemas/approvers";
import { listAllApproverAssignments, listEligibleApproverCandidates } from "@/lib/sis/approvers/queries";
import { getSessionUser } from "@/lib/supabase/server";

export default async function ApproversPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");
  if (sessionUser.role !== "school_admin" && sessionUser.role !== "superadmin") redirect("/sis");

  const [byFlow, candidatesByFlow] = await Promise.all([
    listAllApproverAssignments(),
    Promise.all(APPROVER_FLOWS.map(async (flow) => [flow, await listEligibleApproverCandidates(flow)] as const)).then(
      (entries) =>
        Object.fromEntries(entries) as Record<ApproverFlow, Array<{ user_id: string; email: string; role: string }>>,
    ),
  ]);

  return (
    <PageShell>
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        Dashboard
      </Link>

      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Records · Admin · Approvers
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Approver assignments.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Designate which school administrators are approvers for each approval flow. When a teacher files a
          locked-sheet change request, they pick a primary + secondary from the flow&apos;s list; only those two see and
          act on it.
        </p>
      </header>

      <div className="space-y-6">
        {APPROVER_FLOWS.map((flow) => {
          const assignments = byFlow[flow] ?? [];
          const candidates = candidatesByFlow[flow] ?? [];
          return (
            <Card key={flow} className="overflow-hidden p-0">
              <CardHeader className="border-b border-hairline bg-muted/40 px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 font-serif text-lg font-semibold">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                        <ShieldCheck className="size-4" />
                      </div>
                      {APPROVER_FLOW_LABELS[flow]}
                    </CardTitle>
                    <CardDescription className="text-xs leading-relaxed">
                      {APPROVER_FLOW_DESCRIPTIONS[flow]}
                    </CardDescription>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Flow key: <code className="rounded bg-muted px-1 py-0.5">{flow}</code>
                    </p>
                  </div>
                  <ApproverAssignDialog flow={flow} flowLabel={APPROVER_FLOW_LABELS[flow]} candidates={candidates} />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {assignments.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">
                    No approvers assigned yet. Teachers can&apos;t file requests for this flow until at least two
                    approvers are configured.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableHead>User</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Assigned</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assignments.map((a) => (
                        <TableRow key={a.assignment_id}>
                          <TableCell className="text-sm">{a.email}</TableCell>
                          <TableCell>
                            <Badge variant="default">{a.role ?? "unknown"}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                            {new Date(a.assigned_at).toLocaleDateString("en-SG", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </TableCell>
                          <TableCell className="text-right">
                            <ApproverRevokeButton
                              assignmentId={a.assignment_id}
                              email={a.email}
                              flowLabel={APPROVER_FLOW_LABELS[flow]}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <section className="rounded-xl border border-hairline bg-white p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
          How this works
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong>At least 2 approvers per flow</strong> — teachers must pick both primary and secondary. Fewer than 2
            = the request form is blocked with a message telling them to contact you.
          </li>
          <li>
            <strong>First to act wins</strong> — primary and secondary both see every request in their inbox and can
            approve/reject independently. There&apos;s no escalation timer.
          </li>
          <li>
            <strong>Revocation is forward-only</strong> — removing an approver here does NOT pull them from in-flight
            requests where they&apos;re already designated. They can still act on those until the request is resolved.
          </li>
          <li>
            <strong>Only school administrators are eligible</strong> as approvers — superadmins manage this list but
            don&apos;t approve change requests themselves. If you need someone as an approver, set their role to{" "}
            <code className="rounded bg-muted px-1 py-0.5">school_admin</code>
            in Supabase Auth first.
          </li>
        </ul>
      </section>
    </PageShell>
  );
}
