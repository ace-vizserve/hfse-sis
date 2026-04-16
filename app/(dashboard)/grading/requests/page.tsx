import { ArrowUpRight, CheckCircle2, Circle, CircleCheck, CircleX, XCircle } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getUserRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { MyRequestsCancelButton } from "./my-requests-cancel-button";

type RequestRow = {
  id: string;
  grading_sheet_id: string;
  grade_entry_id: string;
  field_changed: string;
  slot_index: number | null;
  current_value: string | null;
  proposed_value: string;
  reason_category: string;
  justification: string;
  status: "pending" | "approved" | "rejected" | "applied" | "cancelled";
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by_email: string | null;
  decision_note: string | null;
  applied_at: string | null;
};

const STATUS_CONFIG: Record<RequestRow["status"], { label: string; icon: typeof Circle; className: string }> = {
  pending: {
    label: "Awaiting Review",
    icon: Circle,
    className: "border-border bg-muted text-muted-foreground",
  },
  approved: {
    label: "Approved · Awaiting Changes",
    icon: CheckCircle2,
    className: "border-primary/30 bg-primary/10 text-primary",
  },
  applied: {
    label: "Changes Applied",
    icon: CircleCheck,
    className: "border-brand-mint bg-brand-mint/30 text-ink",
  },
  rejected: {
    label: "Declined",
    icon: XCircle,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  cancelled: {
    label: "Cancelled",
    icon: CircleX,
    className: "border-border bg-muted/50 text-muted-foreground",
  },
};

function fieldLabel(field: string, slot: number | null): string {
  switch (field) {
    case "ww_scores":
      return slot != null ? `W${slot + 1}` : "WW";
    case "pt_scores":
      return slot != null ? `PT${slot + 1}` : "PT";
    case "qa_score":
      return "QA";
    case "letter_grade":
      return "Letter";
    case "is_na":
      return "N/A";
    default:
      return field;
  }
}

export default async function MyRequestsPage() {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const role = getUserRole(userRes.user);
  if (!role) redirect("/parent");

  // Teachers see only their own; anyone else can still view this page as a
  // history of their own-filed requests (admin usually files none).
  const service = createServiceClient();
  const { data: rawRows } = await service
    .from("grade_change_requests")
    .select(
      `id, grading_sheet_id, grade_entry_id, field_changed, slot_index,
       current_value, proposed_value, reason_category, justification,
       status, requested_at, reviewed_at, reviewed_by_email, decision_note,
       applied_at`,
    )
    .eq("requested_by", userRes.user.id)
    .order("requested_at", { ascending: false });

  const rows = (rawRows ?? []) as RequestRow[];

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    { pending: 0, approved: 0, rejected: 0, applied: 0, cancelled: 0 } as Record<RequestRow["status"], number>,
  );

  return (
    <PageShell>
      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Grading · Change requests
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          My requests
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Track the change requests you have filed on locked grading sheets. Approved requests are applied by the
          registrar.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Pending" value={counts.pending} />
        <StatCard label="Approved" value={counts.approved} />
        <StatCard label="Applied" value={counts.applied} />
        <StatCard label="Declined" value={counts.rejected} />
        <StatCard label="Cancelled" value={counts.cancelled} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All requests</CardTitle>
          <CardDescription>Newest first. You can cancel a request while it is still pending.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filed</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    You haven&apos;t filed any change requests yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(r.requested_at).toLocaleString("en-SG", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {fieldLabel(r.field_changed, r.slot_index)}
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {r.current_value ?? "(blank)"} <span className="text-muted-foreground">→</span>{" "}
                      <span className="font-medium">{r.proposed_value}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.reason_category.replace(/_/g, " ")}
                      {r.decision_note && (
                        <div className="mt-0.5 line-clamp-1 text-[11px]">Note: {r.decision_note}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const cfg = STATUS_CONFIG[r.status];
                        const Icon = cfg.icon;
                        return (
                          <Badge
                            variant="outline"
                            className={`h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${cfg.className}`}>
                            <Icon className="h-3 w-3" />
                            {cfg.label}
                          </Badge>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/grading/${r.grading_sheet_id}`}
                          className="inline-flex items-center gap-1 text-xs text-primary">
                          Sheet
                          <ArrowUpRight className="size-3" />
                        </Link>
                        {r.status === "pending" && <MyRequestsCancelButton requestId={r.id} />}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground">
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
