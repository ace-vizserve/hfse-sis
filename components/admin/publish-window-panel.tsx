"use client";

import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck2,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileCheck2,
  Loader2,
  MessageSquare,
  Share2,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";

type Term = { id: string; term_number: number; label: string };

type Publication = {
  id: string;
  section_id: string;
  term_id: string;
  publish_from: string;
  publish_until: string;
  published_by: string;
};

type Status = "active" | "scheduled" | "expired" | "none";

type ChecklistData = {
  grading_sheets: {
    total: number;
    locked: number;
    unlocked: { subject_name: string }[];
  };
  evaluations: {
    total_active: number;
    submitted: number;
    drafted: number;
    missing: { name: string; index: number | null }[];
  };
  attendance: {
    total_active: number;
    complete: number;
    missing: { name: string; index: number | null }[];
  };
  t4_readiness: {
    all_terms_locked: boolean;
    unlocked_terms: { term_number: number; subjects: string[] }[];
    missing_annual_grades: { student_name: string; subject_name: string; missing_terms: number[] }[];
    missing_annual_count: number;
  } | null;
};

function statusOf(p: Publication | undefined): Status {
  if (!p) return "none";
  const now = new Date();
  const from = new Date(p.publish_from);
  const until = new Date(p.publish_until);
  if (now < from) return "scheduled";
  if (now > until) return "expired";
  return "active";
}

function StatusBadge({ status }: { status: Status }) {
  switch (status) {
    case "active":
      return (
        <Badge
          variant="outline"
          className="h-6 border-brand-mint bg-brand-mint/30 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink">
          <CheckCircle2 className="h-3 w-3" />
          Published
        </Badge>
      );
    case "scheduled":
      return (
        <Badge
          variant="outline"
          className="h-6 border-brand-indigo-soft/60 bg-accent px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-indigo-deep">
          <Clock className="h-3 w-3" />
          Scheduled
        </Badge>
      );
    case "expired":
      return (
        <Badge
          variant="outline"
          className="h-6 border-destructive/40 bg-destructive/10 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-destructive">
          Expired
        </Badge>
      );
    default:
      return (
        <Badge
          variant="outline"
          className="h-6 border-dashed border-border bg-muted px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Not published
        </Badge>
      );
  }
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// One row in the publishing checklist. Each row carries:
//   - A status-tinted gradient icon tile (mint for passed, amber for
//     warning) so the eye picks out failing rows at a glance.
//   - The check title + summary line + optional detail (subjects /
//     student names).
//   - A quick-link button on the right that deep-links into the module
//     where the registrar can fix the issue. Always rendered so the
//     dialog doubles as a navigation hub — even passing rows let the
//     registrar verify in one click.
function ChecklistRow({
  passed,
  icon: Icon,
  eyebrow,
  title,
  summary,
  detail,
  studentList,
  href,
  actionLabel,
}: {
  passed: boolean;
  icon: React.ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
  summary: string;
  detail?: string;
  studentList?: { name: string; index: number | null }[];
  href: string;
  actionLabel: string;
}) {
  const tileClass = passed
    ? "bg-gradient-to-br from-brand-mint to-brand-sky shadow-brand-tile-mint"
    : "bg-gradient-to-br from-brand-amber to-brand-amber/80 shadow-brand-tile-amber";

  return (
    <div className="rounded-xl border border-hairline bg-card p-3.5 ring-1 ring-inset ring-border/40">
      <div className="flex items-start gap-3">
        {/* Status icon tile — mint→sky gradient when passed, amber when
            warning. shadow-brand-tile-{mint,amber} per non-flat T1 tile
            recipe (09a-design-patterns.md §8). */}
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl text-white ${tileClass}`}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-serif text-[15px] font-semibold leading-tight tracking-tight text-foreground">
              {title}
            </p>
            <Badge variant={passed ? "success" : "warning"} className="h-5">
              {passed ? <CheckCircle2 /> : <XCircle />}
              {summary}
            </Badge>
          </div>
          {detail && (
            <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
          )}
          {studentList && studentList.length > 0 && (
            <ScrollArea className="mt-1 h-20">
              <ul className="space-y-0.5 pr-3 text-xs text-muted-foreground">
                {studentList.map((s, i) => (
                  <li key={i} className="tabular-nums">
                    {s.index != null && (
                      <span className="mr-1.5 font-mono text-[10px] text-hairline-strong">
                        #{s.index}
                      </span>
                    )}
                    {s.name}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>
        {/* Quick-link button — deep-links into the relevant module surface
            so the registrar can jump straight to the fix without losing
            their place. Navigating away dismisses the dialog naturally;
            re-publish trigger picks up the fixed state. */}
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link href={href}>
            {actionLabel}
            <ArrowUpRight className="size-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function PublishWindowPanel({
  sectionId,
  sectionName,
  terms,
}: {
  sectionId: string;
  sectionName: string;
  terms: Term[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<ChecklistData | null>(null);
  const [pendingPublishTermId, setPendingPublishTermId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await fetch(`/api/report-card-publications?section_id=${sectionId}`);
      const body = await res.json();
      if (!cancelled) {
        setPublications((body.publications ?? []) as Publication[]);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sectionId]);

  async function save(termId: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/report-card-publications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          section_id: sectionId,
          term_id: termId,
          publish_from: from,
          publish_until: until,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "publish failed");
      const reload = await fetch(`/api/report-card-publications?section_id=${sectionId}`);
      const reloadBody = await reload.json();
      setPublications((reloadBody.publications ?? []) as Publication[]);
      setEditingTermId(null);
      toast.success("Publication window saved");
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save publication window");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(publicationId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/report-card-publications/${publicationId}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "revoke failed");
      setPublications((prev) => prev.filter((p) => p.id !== publicationId));
      toast.success("Publication revoked");
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to revoke publication");
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish(termId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/sections/${sectionId}/publish-readiness?term_id=${termId}`);
      if (!res.ok) {
        await save(termId);
        return;
      }
      const data = (await res.json()) as ChecklistData;

      const hasIssues =
        data.grading_sheets.unlocked.length > 0 ||
        data.evaluations.missing.length > 0 ||
        data.attendance.missing.length > 0 ||
        (data.t4_readiness && (!data.t4_readiness.all_terms_locked || data.t4_readiness.missing_annual_count > 0));

      if (!hasIssues) {
        await save(termId);
      } else {
        setChecklist(data);
        setPendingPublishTermId(termId);
      }
    } catch {
      await save(termId);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(termId: string, existing?: Publication) {
    setEditingTermId(termId);
    if (existing) {
      setFrom(existing.publish_from);
      setUntil(existing.publish_until);
    } else {
      const now = new Date();
      const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      setFrom(now.toISOString());
      setUntil(twoWeeks.toISOString());
    }
  }

  const checklistOpen = checklist !== null;
  const sheetsOk = checklist ? checklist.grading_sheets.unlocked.length === 0 : true;
  const commentsOk = checklist ? checklist.evaluations.missing.length === 0 : true;
  const attendanceOk = checklist ? checklist.attendance.missing.length === 0 : true;
  const t4LockedOk = checklist?.t4_readiness ? checklist.t4_readiness.all_terms_locked : true;
  const t4GradesOk = checklist?.t4_readiness ? checklist.t4_readiness.missing_annual_count === 0 : true;

  return (
    <Card className="@container/card gap-0 py-0">
      <CardHeader className="border-b border-border py-5">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Parent access
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Publish windows
        </CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Share2 className="size-5" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3 px-0 pt-0">
        <p className="px-6 pt-4 text-sm text-muted-foreground">
          Publish each term to parents within a time window. Parents sign in to the parent portal and can only view
          terms with an active window.
        </p>

        {loading && (
          <div className="flex items-center gap-2 px-6 pb-4 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading publications…
          </div>
        )}

        {!loading && (
          <ul className="divide-y divide-border border-t border-border">
            {terms.map((term) => {
              const existing = publications.find((p) => p.term_id === term.id);
              const status = statusOf(existing);
              const isEditing = editingTermId === term.id;

              return (
                <li key={term.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="font-serif text-base font-semibold tracking-tight text-foreground">
                          {term.label}
                        </span>
                        <StatusBadge status={status} />
                      </div>
                      {existing && (
                        <div className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {fmt(existing.publish_from)}
                          <ArrowRight className="size-3 text-hairline-strong" />
                          {fmt(existing.publish_until)}
                        </div>
                      )}
                    </div>
                    {!isEditing && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={existing ? "outline" : "default"}
                          onClick={() => startEdit(term.id, existing)}
                          disabled={busy}>
                          {existing ? "Edit window" : "Publish"}
                        </Button>
                        {existing && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPendingRevokeId(existing.id)}
                            disabled={busy}>
                            <X className="h-3.5 w-3.5" />
                            Revoke
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {isEditing && (
                    <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
                      <FieldGroup>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field>
                            <FieldLabel htmlFor={`from-${term.id}`}>Publish from</FieldLabel>
                            <DateTimePicker
                              id={`from-${term.id}`}
                              value={from}
                              onChange={setFrom}
                              placeholder="Start date & time"
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={`until-${term.id}`}>Publish until</FieldLabel>
                            <DateTimePicker
                              id={`until-${term.id}`}
                              value={until}
                              onChange={setUntil}
                              placeholder="End date & time"
                            />
                          </Field>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditingTermId(null)} disabled={busy}>
                            Cancel
                          </Button>
                          <Button size="sm" onClick={() => handlePublish(term.id)} disabled={busy || !from || !until}>
                            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {existing ? "Update window" : "Publish"}
                          </Button>
                        </div>
                      </FieldGroup>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {/* Revoke confirmation */}
      <AlertDialog
        open={pendingRevokeId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevokeId(null);
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this publication?</AlertDialogTitle>
            <AlertDialogDescription>
              Parents will lose access to the report card immediately. You can re-publish later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                const id = pendingRevokeId;
                setPendingRevokeId(null);
                if (id) await revoke(id);
              }}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish readiness checklist — surfaces grading-sheet locks,
          adviser-comment coverage, attendance, and (T4 only) annual-grade
          completeness. Each row deep-links into the module where the
          registrar can fix the issue without losing their place. The
          checks are warnings (not blockers) — registrar can always
          "Publish anyway" per KD #28. */}
      <AlertDialog
        open={checklistOpen}
        onOpenChange={(open) => {
          if (!open) {
            setChecklist(null);
            setPendingPublishTermId(null);
          }
        }}>
        <AlertDialogContent className="max-w-2xl!">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-[22px] font-semibold tracking-tight">
              Publishing checklist
            </AlertDialogTitle>
            <AlertDialogDescription>
              Some items need attention before publishing to parents. You can still proceed — these
              are warnings, not blockers. Use the quick-links to jump into each module and fix
              issues, then re-publish.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {checklist && (
            <div className="space-y-2.5">
              {/* Core three checks — same scope across every term. */}
              <ChecklistRow
                passed={sheetsOk}
                icon={FileCheck2}
                eyebrow="Markbook"
                title="Grading sheets"
                summary={
                  sheetsOk
                    ? `${checklist.grading_sheets.total} locked`
                    : `${checklist.grading_sheets.unlocked.length} unlocked`
                }
                detail={
                  sheetsOk
                    ? `All ${checklist.grading_sheets.total} sheet${checklist.grading_sheets.total === 1 ? "" : "s"} locked and ready to publish.`
                    : `Unlocked subject${checklist.grading_sheets.unlocked.length === 1 ? "" : "s"}: ${checklist.grading_sheets.unlocked.map((s) => s.subject_name).join(", ")}`
                }
                href={`/markbook/grading?section=${sectionId}`}
                actionLabel={sheetsOk ? "View" : "Lock sheets"}
              />

              <ChecklistRow
                passed={commentsOk}
                icon={MessageSquare}
                eyebrow="Evaluation"
                title="Adviser comments"
                summary={
                  commentsOk
                    ? `${checklist.evaluations.total_active} written`
                    : `${checklist.evaluations.missing.length} missing`
                }
                detail={
                  commentsOk
                    ? `All ${checklist.evaluations.total_active} active student comment${checklist.evaluations.total_active === 1 ? "" : "s"} on file.`
                    : undefined
                }
                studentList={!commentsOk ? checklist.evaluations.missing : undefined}
                href={`/evaluation/sections/${sectionId}`}
                actionLabel={commentsOk ? "View" : "Write comments"}
              />

              <ChecklistRow
                passed={attendanceOk}
                icon={CalendarCheck2}
                eyebrow="Attendance"
                title="Attendance records"
                summary={
                  attendanceOk
                    ? `${checklist.attendance.total_active} complete`
                    : `${checklist.attendance.missing.length} missing`
                }
                detail={
                  attendanceOk
                    ? `All ${checklist.attendance.total_active} active student record${checklist.attendance.total_active === 1 ? "" : "s"} marked.`
                    : undefined
                }
                studentList={!attendanceOk ? checklist.attendance.missing : undefined}
                href={`/attendance/${sectionId}`}
                actionLabel={attendanceOk ? "View" : "Mark attendance"}
              />

              {/* T4 final-card sub-checks — only render on the T4 publish path. */}
              {checklist.t4_readiness && (
                <>
                  <div className="flex items-center gap-3 pt-2">
                    <div className="h-px flex-1 bg-border" />
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Term 4 final card
                    </p>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  <ChecklistRow
                    passed={t4LockedOk}
                    icon={ClipboardCheck}
                    eyebrow="Markbook · T1–T4"
                    title="All terms locked"
                    summary={
                      t4LockedOk
                        ? "4 of 4 locked"
                        : `${checklist.t4_readiness.unlocked_terms.length} unlocked`
                    }
                    detail={
                      t4LockedOk
                        ? "Every term's grading sheets are locked — Final Grade can be computed."
                        : checklist.t4_readiness.unlocked_terms
                            .map((t) => `T${t.term_number}: ${t.subjects.join(", ")}`)
                            .join(" · ")
                    }
                    href={`/markbook/grading?section=${sectionId}`}
                    actionLabel={t4LockedOk ? "View" : "Lock prior terms"}
                  />

                  <ChecklistRow
                    passed={t4GradesOk}
                    icon={FileCheck2}
                    eyebrow="Markbook · Final grade"
                    title="Quarterly grades"
                    summary={
                      t4GradesOk
                        ? "All present"
                        : `${checklist.t4_readiness.missing_annual_count} missing`
                    }
                    detail={
                      t4GradesOk
                        ? "Every (student × subject) has Q1–Q4 grades for Final Grade computation."
                        : checklist.t4_readiness.missing_annual_grades
                            .slice(0, 5)
                            .map(
                              (g) => `${g.student_name} — ${g.subject_name} (T${g.missing_terms.join(",")})`,
                            )
                            .join("; ") +
                          (checklist.t4_readiness.missing_annual_count > 5
                            ? ` … and ${checklist.t4_readiness.missing_annual_count - 5} more`
                            : "")
                    }
                    href={`/markbook/grading?section=${sectionId}`}
                    actionLabel={t4GradesOk ? "View" : "Backfill grades"}
                  />
                </>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const termId = pendingPublishTermId;
                setChecklist(null);
                setPendingPublishTermId(null);
                if (termId) await save(termId);
              }}>
              Publish anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
