'use client';

import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Loader2,
  Share2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';

type Term = { id: string; term_number: number; label: string };

type Publication = {
  id: string;
  section_id: string;
  term_id: string;
  publish_from: string;
  publish_until: string;
  published_by: string;
};

type Status = 'active' | 'scheduled' | 'expired' | 'none';

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
    missing_annual_grades: {
      student_name: string;
      subject_name: string;
      missing_terms: number[];
    }[];
    missing_annual_count: number;
    non_examinable_readiness: {
      missing: { student_name: string; subject_name: string }[];
      missing_count: number;
    };
    letterhead_readiness: {
      ok: boolean;
      missing_fields: string[];
    };
  } | null;
  virtue_readiness: {
    ok: boolean;
    term_label: string;
  } | null;
};

function statusOf(p: Publication | undefined): Status {
  if (!p) return 'none';
  const now = new Date();
  const from = new Date(p.publish_from);
  const until = new Date(p.publish_until);
  if (now < from) return 'scheduled';
  if (now > until) return 'expired';
  return 'active';
}

// Order + labels for the status summary strip. Kept next to statusOf so the
// strip counts and the per-row badges can never describe different states.
const STATUS_ORDER: Status[] = ['active', 'scheduled', 'expired', 'none'];
const STATUS_LABEL: Record<Status, string> = {
  active: 'Published',
  scheduled: 'Scheduled',
  expired: 'Expired',
  none: 'Not published',
};

function StatusBadge({ status }: { status: Status }) {
  switch (status) {
    case 'active':
      return (
        <Badge
          variant="outline"
          className="h-6 border-brand-mint bg-brand-mint/30 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink"
        >
          <CheckCircle2 className="h-3 w-3" />
          Published
        </Badge>
      );
    case 'scheduled':
      return (
        <Badge
          variant="outline"
          className="h-6 border-brand-indigo-soft/60 bg-accent px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-indigo-deep"
        >
          <Clock className="h-3 w-3" />
          Scheduled
        </Badge>
      );
    case 'expired':
      return (
        <Badge
          variant="outline"
          className="h-6 border-destructive/40 bg-destructive/10 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-destructive"
        >
          <AlertTriangle className="h-3 w-3" />
          Expired
        </Badge>
      );
    default:
      return (
        <Badge
          variant="outline"
          className="h-6 border-dashed border-border bg-muted px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
        >
          Not published
        </Badge>
      );
  }
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// One compact row in the publishing checklist — a triage line, not a card.
// The detail (which subjects / which students) lives one click away in the
// module the link points to, so each row only flags the check, its count,
// and the deep-link. A mint check / amber warning icon carries the state
// (shape, not colour alone). Passing rows keep a quiet "View" link so the
// dialog still doubles as a navigation hub.
function ChecklistRow({
  passed,
  title,
  summary,
  href,
  actionLabel,
}: {
  passed: boolean;
  title: string;
  summary: string;
  href: string;
  actionLabel: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      {passed ? (
        <CheckCircle2 className="size-4 shrink-0 text-brand-mint" aria-hidden />
      ) : (
        <AlertTriangle
          className="size-4 shrink-0 text-brand-amber"
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {title}
      </span>
      <span
        className={`shrink-0 text-xs tabular-nums ${
          passed ? 'text-muted-foreground' : 'font-medium text-brand-amber'
        }`}
      >
        {summary}
      </span>
      <Button
        asChild
        size="sm"
        variant={passed ? 'ghost' : 'outline'}
        className="shrink-0"
      >
        <Link href={href}>
          {actionLabel}
          <ArrowUpRight className="size-3" />
        </Link>
      </Button>
    </div>
  );
}

export function PublishWindowPanel({
  sectionId,
  levelId,
  terms,
}: {
  sectionId: string;
  /** Level the section belongs to — needed for the precise Masterfile
   *  deep-link (`?level=` is required there; `?class=` filters within it). */
  levelId: string | null;
  terms: Term[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<ChecklistData | null>(null);
  const [pendingPublishTermId, setPendingPublishTermId] = useState<
    string | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await fetch(
        `/api/report-card-publications?section_id=${sectionId}`
      );
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
      const res = await fetch('/api/report-card-publications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          section_id: sectionId,
          term_id: termId,
          publish_from: from,
          publish_until: until,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'publish failed');
      const reload = await fetch(
        `/api/report-card-publications?section_id=${sectionId}`
      );
      const reloadBody = await reload.json();
      setPublications((reloadBody.publications ?? []) as Publication[]);
      setEditingTermId(null);
      toast.success('Publication window saved');
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Failed to save publication window'
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(publicationId: string) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/report-card-publications/${publicationId}`,
        {
          method: 'DELETE',
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'revoke failed');
      setPublications((prev) => prev.filter((p) => p.id !== publicationId));
      toast.success('Publication revoked');
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Failed to revoke publication'
      );
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish(termId: string) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/sections/${sectionId}/publish-readiness?term_id=${termId}`
      );
      if (!res.ok) {
        await save(termId);
        return;
      }
      const data = (await res.json()) as ChecklistData;

      const hasIssues =
        data.grading_sheets.unlocked.length > 0 ||
        data.evaluations.missing.length > 0 ||
        data.evaluations.drafted > 0 ||
        data.attendance.missing.length > 0 ||
        (data.virtue_readiness && !data.virtue_readiness.ok) ||
        (data.t4_readiness &&
          (!data.t4_readiness.all_terms_locked ||
            data.t4_readiness.missing_annual_count > 0 ||
            data.t4_readiness.non_examinable_readiness.missing_count > 0 ||
            !data.t4_readiness.letterhead_readiness.ok));

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
  const sheetsOk = checklist
    ? checklist.grading_sheets.unlocked.length === 0
    : true;
  // Adviser comments are a T1–T3 concern only (no FCA block on the T4 final
  // card, KD #49). The route reports neutral on T4, but we also hide the row
  // there — t4_readiness is non-null exactly on the T4 publish path.
  const isT4Checklist = checklist?.t4_readiness != null;
  // commentsOk is true only when nothing is missing AND nothing is still drafted.
  // drafted > 0 renders as an amber warning so the registrar sees unfinished writeups.
  const commentsOk = checklist
    ? checklist.evaluations.missing.length === 0 &&
      checklist.evaluations.drafted === 0
    : true;
  const attendanceOk = checklist
    ? checklist.attendance.missing.length === 0
    : true;
  const t4LockedOk = checklist?.t4_readiness
    ? checklist.t4_readiness.all_terms_locked
    : true;
  const t4GradesOk = checklist?.t4_readiness
    ? checklist.t4_readiness.missing_annual_count === 0
    : true;
  const nonExamOk = checklist?.t4_readiness
    ? checklist.t4_readiness.non_examinable_readiness.missing_count === 0
    : true;
  const letterheadOk = checklist?.t4_readiness
    ? checklist.t4_readiness.letterhead_readiness.ok
    : true;
  const virtueOk = checklist?.virtue_readiness
    ? checklist.virtue_readiness.ok
    : true;

  // Status summary for the meta strip — one tally per state, keyed on the same
  // statusOf() the per-row badges use so the counts can't drift from the rows.
  const statusCounts: Record<Status, number> = {
    active: 0,
    scheduled: 0,
    expired: 0,
    none: 0,
  };
  for (const term of terms) {
    statusCounts[statusOf(publications.find((p) => p.term_id === term.id))] +=
      1;
  }

  // Canonical deep-links (KD #81). Grading filters by the exact section id;
  // Masterfile needs the level (it falls back to the first level otherwise).
  const gradingHref = `/markbook/grading?section=${sectionId}`;
  const masterfileHref = levelId
    ? `/records/academic-summary?level=${levelId}&class=${sectionId}`
    : '/records/academic-summary';

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

      <p className="px-6 pt-4 text-sm leading-relaxed text-muted-foreground">
        Parents sign in to the parent portal and see a term&apos;s report card
        only while its window is active.
      </p>

      {/* Status summary strip (§8 group-container pattern) — at-a-glance tally
          of where the four terms stand. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-2 border-y border-border bg-muted/30 px-6 py-3">
        {STATUS_ORDER.map((s) => (
          <span key={s} className="inline-flex items-baseline gap-1.5">
            {loading ? (
              <Skeleton className="h-5 w-5" />
            ) : (
              <span className="font-serif text-base font-semibold tabular-nums text-foreground">
                {statusCounts[s]}
              </span>
            )}
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {STATUS_LABEL[s]}
            </span>
          </span>
        ))}
      </div>

      {loading ? (
        <ul className="divide-y divide-border">
          {terms.map((term) => (
            <li
              key={term.id}
              className="flex items-center justify-between px-6 py-4"
            >
              <div className="space-y-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-3 w-44" />
              </div>
              <Skeleton className="h-8 w-24 rounded-md" />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-border">
          {terms.map((term) => {
            const existing = publications.find((p) => p.term_id === term.id);
            const status = statusOf(existing);
            const isEditing = editingTermId === term.id;

            return (
              <li key={term.id} className="px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-3">
                      <span className="font-serif text-base font-semibold tracking-tight text-foreground">
                        {term.label}
                      </span>
                      <StatusBadge status={status} />
                    </div>
                    {existing ? (
                      <div className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                        <Clock
                          className="size-3 text-hairline-strong"
                          aria-hidden
                        />
                        {fmt(existing.publish_from)}
                        <ArrowRight className="size-3 text-hairline-strong" />
                        {fmt(existing.publish_until)}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No window set — not visible to parents yet.
                      </p>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(term.id, existing)}
                        disabled={busy}
                      >
                        {existing ? 'Edit window' : 'Publish'}
                      </Button>
                      {existing && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setPendingRevokeId(existing.id)}
                          disabled={busy}
                        >
                          <X className="h-3.5 w-3.5" />
                          Revoke
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {isEditing && (
                  <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
                    <FieldGroup>
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {existing ? 'Edit window' : 'Set window'}
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor={`from-${term.id}`}>
                            Publish from
                          </FieldLabel>
                          <DateTimePicker
                            id={`from-${term.id}`}
                            value={from}
                            onChange={setFrom}
                            placeholder="Start date & time"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor={`until-${term.id}`}>
                            Publish until
                          </FieldLabel>
                          <DateTimePicker
                            id={`until-${term.id}`}
                            value={until}
                            onChange={setUntil}
                            placeholder="End date & time"
                          />
                        </Field>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingTermId(null)}
                          disabled={busy}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handlePublish(term.id)}
                          disabled={busy || !from || !until}
                        >
                          {busy && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          )}
                          {existing ? 'Update window' : 'Publish'}
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

      {/* Revoke confirmation */}
      <AlertDialog
        open={pendingRevokeId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevokeId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this publication?</AlertDialogTitle>
            <AlertDialogDescription>
              Parents will lose access to the report card immediately. You can
              re-publish later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const id = pendingRevokeId;
                setPendingRevokeId(null);
                if (id) await revoke(id);
              }}
            >
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
        }}
      >
        <AlertDialogContent className="flex max-h-[85dvh] max-w-2xl! flex-col gap-0 overflow-hidden">
          {/* Custom header — gradient tile + four type voices (mono eyebrow /
              serif title / sans body). AlertDialogTitle + Description stay for
              a11y; the AlertDialogHeader wrapper is skipped so the layout is
              left-aligned with the icon tile. */}
          <div className="flex shrink-0 items-start gap-3 pb-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <ClipboardCheck className="size-5" />
            </div>
            <div className="space-y-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Pre-publish check
              </p>
              <AlertDialogTitle className="font-serif text-[20px] font-semibold leading-tight tracking-tight">
                Publishing checklist
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm leading-relaxed text-muted-foreground">
                A few items need attention before publishing to parents. These
                are warnings, not hard stops — fix each via the quick-links, or
                publish anyway.
              </AlertDialogDescription>
            </div>
          </div>

          {checklist && (
            <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto border-t border-border">
              {/* Core checks — same scope across every term. */}
              <ChecklistRow
                passed={sheetsOk}
                title="Grading sheets"
                summary={
                  sheetsOk
                    ? `${checklist.grading_sheets.total} locked`
                    : `${checklist.grading_sheets.unlocked.length} unlocked`
                }
                href={gradingHref}
                actionLabel={sheetsOk ? 'View' : 'Lock sheets'}
              />

              {/* Adviser comments — T1–T3 only (T4 final card has no FCA
                  comment block, KD #49). */}
              {!isT4Checklist && (
                <ChecklistRow
                  passed={commentsOk}
                  title="Adviser comments"
                  summary={(() => {
                    const { submitted, drafted, missing } =
                      checklist.evaluations;
                    if (missing.length > 0 && drafted > 0)
                      return `${missing.length} missing · ${drafted} drafted`;
                    if (missing.length > 0) return `${missing.length} missing`;
                    if (drafted > 0) return `${drafted} drafted`;
                    return `${submitted} submitted`;
                  })()}
                  href={`/evaluation/sections/${sectionId}`}
                  actionLabel={commentsOk ? 'View' : 'Review comments'}
                />
              )}

              <ChecklistRow
                passed={attendanceOk}
                title="Attendance records"
                summary={
                  attendanceOk
                    ? `${checklist.attendance.total_active} complete`
                    : `${checklist.attendance.missing.length} missing`
                }
                href={`/attendance/${sectionId}`}
                actionLabel={attendanceOk ? 'View' : 'Mark attendance'}
              />

              {/* Virtue theme — T1–T3 only (T4 has no FCA comment block per KD #49). */}
              {checklist.virtue_readiness && (
                <ChecklistRow
                  passed={virtueOk}
                  title="Virtue theme"
                  summary={virtueOk ? 'Set' : 'Not set'}
                  href="/sis/ay-setup"
                  actionLabel={virtueOk ? 'View' : 'Set theme'}
                />
              )}

              {/* T4 final-card sub-checks — only render on the T4 publish path. */}
              {checklist.t4_readiness && (
                <>
                  <p className="px-1 pt-3 pb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Term 4 final card
                  </p>

                  <ChecklistRow
                    passed={t4LockedOk}
                    title="All terms locked"
                    summary={
                      t4LockedOk
                        ? '4 of 4'
                        : `${checklist.t4_readiness.unlocked_terms.length} unlocked`
                    }
                    href={gradingHref}
                    actionLabel={t4LockedOk ? 'View' : 'Lock prior terms'}
                  />

                  <ChecklistRow
                    passed={t4GradesOk}
                    title="Quarterly grades"
                    summary={
                      t4GradesOk
                        ? 'All present'
                        : `${checklist.t4_readiness.missing_annual_count} missing`
                    }
                    href={gradingHref}
                    actionLabel={t4GradesOk ? 'View' : 'Backfill grades'}
                  />

                  <ChecklistRow
                    passed={nonExamOk}
                    title="Final grades (non-exam)"
                    summary={
                      nonExamOk
                        ? 'All confirmed'
                        : `${checklist.t4_readiness.non_examinable_readiness.missing_count} not confirmed`
                    }
                    href={masterfileHref}
                    actionLabel={nonExamOk ? 'View' : 'Confirm final grades'}
                  />

                  <ChecklistRow
                    passed={letterheadOk}
                    title="Report card letterhead"
                    summary={letterheadOk ? 'Complete' : 'Incomplete'}
                    href="/sis/admin/school-config"
                    actionLabel={letterheadOk ? 'View' : 'Complete config'}
                  />
                </>
              )}
            </div>
          )}

          <AlertDialogFooter className="shrink-0 border-t border-border pt-4">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const termId = pendingPublishTermId;
                setChecklist(null);
                setPendingPublishTermId(null);
                if (termId) await save(termId);
              }}
            >
              Publish anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
