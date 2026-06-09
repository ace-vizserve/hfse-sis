'use client';

import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Loader2,
  Lock,
  Share2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
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

// One soft gap the registrar published past (snapshotted on the row server-side).
type PublishGap = { code: string; label: string; count?: number };

type Publication = {
  id: string;
  section_id: string;
  term_id: string;
  publish_from: string;
  publish_until: string;
  published_by: string;
  // Null on a clean publish; the override snapshot when the registrar published
  // past one or more soft gaps (KD #28 "publish anyway", now recorded).
  published_with_gaps: { gaps: PublishGap[]; by: string; at: string } | null;
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
  // HARD gate (KD #49 + #120): cumulative adviser-comment completeness for the
  // terms this card will display (1..N, T4 exempt). Unlike every other check,
  // this one BLOCKS publishing — there is no "publish anyway".
  // virtue_missing is surfaced here (not as a separate soft row) because virtue
  // is now part of the comment hard gate: a missing virtue theme on a term also
  // blocks publishing (the server rejects it as part of comment_gate).
  comment_gate: {
    ok: boolean;
    required_through_term: number | null;
    gaps: {
      term_number: number;
      virtue_missing: boolean;
      missing: { name: string; index: number | null }[];
    }[];
  };
  // Verdict (server-derived). hardBlockers stop publishing entirely (codes:
  // no_students, no_grading_sheets, comments_incomplete); softGaps are the
  // overridable "publish anyway" items. canPublish === hardBlockers.length === 0.
  hardBlockers?: PublishGap[];
  softGaps?: PublishGap[];
  canPublish?: boolean;
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

// Is publishing hard-blocked? Prefer the server's verdict (hardBlockers); fall
// back to the legacy comment-gate check if the array is somehow absent so we
// never accidentally allow publishing past a comment gap.
function isHardBlocked(data: ChecklistData): boolean {
  if (data.hardBlockers) return data.hardBlockers.length > 0;
  return data.comment_gate ? !data.comment_gate.ok : false;
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

// The cumulative adviser-comment row is a HARD requirement, not a soft
// warning — it gets its own visual voice: a destructive (red) lock/alert tile,
// a "Required" eyebrow, and a per-term breakdown of what is still missing.
// Virtue gaps are surfaced here too (not in a separate soft row): a term can
// appear because of missing student comments, a missing virtue theme, or both.
// When the gate fails, publishing is blocked entirely (the dialog's primary
// action is disabled). When it passes, it reads as a quiet mint confirmation.
function HardCommentRow({
  ok,
  gate,
  href,
}: {
  ok: boolean;
  gate: ChecklistData['comment_gate'];
  href: string;
}) {
  const through = gate.required_through_term;
  // Decide whether any gap is virtue-only (all gaps have no missing students,
  // but at least one has virtue_missing) — to pick the most actionable CTA.
  const hasVirtueGaps = gate.gaps.some((g) => g.virtue_missing);
  const hasCommentGaps = gate.gaps.some((g) => g.missing.length > 0);
  // Point virtue-only gaps directly to the virtue-themes editor (KD #137).
  // When both comment and virtue gaps exist, keep the evaluation sections href
  // as the primary action (comments are the more involved fix); the virtue
  // deep-link appears per-line in the breakdown below.
  const primaryHref =
    !ok && hasVirtueGaps && !hasCommentGaps
      ? '/evaluation/virtue-themes'
      : href;
  const primaryLabel = ok
    ? 'View'
    : hasVirtueGaps && !hasCommentGaps
      ? 'Set themes'
      : 'Write comments';
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border px-3 py-3 ${
        ok
          ? 'border-brand-mint/40 bg-brand-mint/10'
          : 'border-destructive/40 bg-destructive/10'
      }`}
    >
      <div className="flex items-center gap-3">
        {ok ? (
          <CheckCircle2
            className="size-4 shrink-0 text-brand-mint"
            aria-hidden
          />
        ) : (
          <Lock className="size-4 shrink-0 text-destructive" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {ok ? 'Required · met' : 'Required to publish'}
          </p>
          <p className="truncate text-sm font-medium text-foreground">
            Adviser comments
            {through ? (
              <span className="text-muted-foreground">
                {' '}
                (Terms 1–{through})
              </span>
            ) : null}
          </p>
        </div>
        <Button
          asChild
          size="sm"
          variant={ok ? 'ghost' : 'destructive'}
          className="shrink-0"
        >
          <Link href={primaryHref}>
            {primaryLabel}
            <ArrowUpRight className="size-3" />
          </Link>
        </Button>
      </div>
      {!ok && (
        <ul className="ml-7 space-y-0.5 text-xs text-destructive">
          {gate.gaps.map((g) => {
            const lines: ReactNode[] = [];
            if (g.missing.length > 0) {
              lines.push(
                <li key={`${g.term_number}-comments`} className="tabular-nums">
                  Term {g.term_number} — {g.missing.length} comment
                  {g.missing.length === 1 ? '' : 's'} missing
                </li>
              );
            }
            if (g.virtue_missing) {
              lines.push(
                <li
                  key={`${g.term_number}-virtue`}
                  className="flex items-center gap-1.5 tabular-nums"
                >
                  <span>Term {g.term_number} — virtue theme not set</span>
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="h-auto px-1 py-0 text-xs text-destructive underline-offset-2 hover:underline"
                  >
                    <Link href="/evaluation/virtue-themes">
                      Set theme
                      <ArrowUpRight className="size-2.5" />
                    </Link>
                  </Button>
                </li>
              );
            }
            return lines;
          })}
        </ul>
      )}
    </div>
  );
}

// A structural hard blocker with no deep-link fix (an empty section, or no
// grading sheets for the term). Same destructive voice as HardCommentRow — a
// red lock tile + "Required to publish" eyebrow + short explanation — but no
// action button, because there is nothing to navigate to: the registrar must
// add students / create grading sheets upstream first.
function HardBlockerRow({
  title,
  explanation,
}: {
  title: string;
  explanation: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-3">
      <Lock className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Required to publish
        </p>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-destructive">{explanation}</p>
      </div>
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
      if (!res.ok) {
        // The server hard-gates on adviser comments (KD #49/#120). When this
        // path is reached without the checklist dialog (e.g. the readiness
        // pre-check fetch failed and we fell through to save), surface a clear,
        // plain-English message instead of the raw server error string.
        if (body.code === 'comments_incomplete') {
          throw new Error(
            "Can't publish yet — some adviser comments aren't submitted. Finish them in Evaluation first."
          );
        }
        throw new Error(body.error ?? 'publish failed');
      }
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

      // The server returns the verdict (hardBlockers / softGaps). Hard blockers
      // (no_students, no_grading_sheets, comments_incomplete) cannot be
      // "published past"; soft gaps can. We open the dialog whenever ANY check
      // (soft or hard) is unsatisfied; the dialog disables its publish action
      // when a hard blocker is present. Fall back to the old comment-gate +
      // per-field detection if the verdict arrays are somehow absent.
      const hardBlocked = isHardBlocked(data);
      const hasSoftIssues = data.softGaps
        ? data.softGaps.length > 0
        : data.grading_sheets.unlocked.length > 0 ||
          data.evaluations.missing.length > 0 ||
          data.evaluations.drafted > 0 ||
          data.attendance.missing.length > 0 ||
          (data.t4_readiness &&
            (!data.t4_readiness.all_terms_locked ||
              data.t4_readiness.missing_annual_count > 0 ||
              data.t4_readiness.non_examinable_readiness.missing_count > 0 ||
              !data.t4_readiness.letterhead_readiness.ok));

      if (!hardBlocked && !hasSoftIssues) {
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
  // The cumulative comment gate is still surfaced as its own hard row; the
  // overall hard-block verdict now spans the full hardBlockers set (empty
  // section / no grading sheets / comments). When hard-blocked, the dialog's
  // publish action is disabled (no "publish anyway").
  const commentGateOk = checklist?.comment_gate
    ? checklist.comment_gate.ok
    : true;
  const hardBlocked = checklist ? isHardBlocked(checklist) : false;
  // The structural existence blockers (no students / no grading sheets) — shown
  // as destructive rows with no deep-link (nothing to navigate to). Read from
  // the server verdict; absent → none (the comment gate is rendered separately).
  const hardBlockerCodes = new Set(
    (checklist?.hardBlockers ?? []).map((b) => b.code)
  );
  const noStudentsBlocked = hardBlockerCodes.has('no_students');
  const noSheetsBlocked = hardBlockerCodes.has('no_grading_sheets');
  const hardBlockerCount = checklist?.hardBlockers?.length ?? 0;

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
                    {/* Override note — this window was published past one or more
                        soft warnings (KD #28). Amber/warning treatment; the
                        shape (icon) carries meaning, not colour alone. */}
                    {existing?.published_with_gaps &&
                      existing.published_with_gaps.gaps.length > 0 && (
                        <div className="flex items-start gap-1.5 text-xs text-brand-amber">
                          <AlertTriangle
                            className="mt-0.5 size-3 shrink-0"
                            aria-hidden
                          />
                          <span>
                            Published with gaps:{' '}
                            {existing.published_with_gaps.gaps
                              .map((g) =>
                                g.count != null
                                  ? `${g.label} (${g.count})`
                                  : g.label
                              )
                              .join(', ')}
                          </span>
                        </div>
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
                {hardBlocked
                  ? 'Some required items are missing before this card can be published — fix the items marked “Required to publish” first. Anything else is a warning you can publish past.'
                  : 'A few items need attention before publishing to parents. These are warnings, not hard stops — fix each via the quick-links, or publish anyway.'}
              </AlertDialogDescription>
            </div>
          </div>

          {checklist && (
            <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto border-t border-border">
              {/* Structural hard blockers (KD #28). Both are vacuous-pass holes:
                  an empty section or a section with no grading sheets would
                  otherwise publish an empty window. No deep-link — the registrar
                  must add students / create grading sheets upstream first. */}
              {noStudentsBlocked && (
                <div className="py-2.5">
                  <HardBlockerRow
                    title="Section has no students"
                    explanation="There is nothing to publish — add students to this section first."
                  />
                </div>
              )}
              {noSheetsBlocked && (
                <div className="py-2.5">
                  <HardBlockerRow
                    title="No grading sheets for this term"
                    explanation="Create grading sheets for this section and term before publishing."
                  />
                </div>
              )}

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

              {/* Adviser comments — HARD requirement, cumulative across the
                  terms this card shows (Terms 1..N, T4 exempt) per KD #49/#120.
                  Unlike every other row, an open gate here BLOCKS publishing
                  (the footer's publish action is disabled below). T1–T3 only —
                  the T4 final card has no FCA comment block. */}
              {!isT4Checklist && (
                <div className="py-2.5">
                  <HardCommentRow
                    ok={commentGateOk}
                    gate={checklist.comment_gate}
                    href={`/evaluation/sections/${sectionId}`}
                  />
                </div>
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
            {!hardBlocked ? (
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
            ) : (
              // A hard blocker is present — publishing is blocked. A disabled
              // plain Button (not AlertDialogAction) so it neither publishes nor
              // closes the dialog; the registrar fixes each required item first.
              <Button disabled variant="destructive">
                <Lock className="size-3.5" />
                Cannot publish — {hardBlockerCount} item
                {hardBlockerCount === 1 ? '' : 's'} required
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
