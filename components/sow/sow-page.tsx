'use client';

import {
  BookText,
  Check,
  ChevronDown,
  Clock,
  Download,
  Info,
  RotateCcw,
  Send,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { ApprovalStepRail } from '@/components/approvals/approval-step-rail';
import {
  EditModuleSheet,
  MODULE_FIELDS,
} from '@/components/sow/edit-module-sheet';
import { EditWeekSheet } from '@/components/sow/edit-week-sheet';
import {
  formatMoment,
  formatRange,
  formatTermRange,
} from '@/components/sow/format';
import { ReopenSowDialog } from '@/components/sow/reopen-sow-dialog';
import { ReturnSowDialog } from '@/components/sow/return-sow-dialog';
import { SowStatusBadge } from '@/components/sow/sow-status-badge';
import { WeekChecks } from '@/components/sow/week-checks';
import { WeekList } from '@/components/sow/week-list';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { RichText } from '@/components/ui/rich-text';
import { useRefreshTransition } from '@/lib/hooks/use-refresh-transition';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';
import type { SowView } from '@/lib/sow/read';

// The SOW page (board 3 and the SowPage component). One component for every
// state: draft and returned (Task 8/9), and in review, the approver's view
// and approved (Task 10, boards 5–8).
//
// What the caller may EDIT comes from `view.capability`: 'edit' shows the
// edit controls, 'read' shows the same page without them. What they may
// DECIDE comes from `view.review.canDecide` — the live step names them — and
// the decide route re-checks it inside its lock.

export function SowPage({ view }: { view: SowView }) {
  const run = useWriteAction();
  const awaitRefresh = useRefreshTransition();
  const [editing, setEditing] = useState<number | null>(null);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);

  const d = view.display;
  const canEdit = view.capability === 'edit';
  const name = `${d.levelLabel} ${d.subjectName}`;
  const termName = `Term ${d.termNumber}`;
  const sowTitle = `${name} · ${termName}`;
  const termDates = formatTermRange(d.termStart, d.termEnd);
  const meta = [
    view.key.track,
    termDates ? `${termName}, ${termDates}` : termName,
    view.classes.map((c) => c.name).join(', '),
  ].filter(Boolean);
  const returned = view.state === 'returned';
  const returnNote = returned ? d.returnNote : null;
  const editingWeek =
    editing === null
      ? null
      : (view.weeks.find((w) => w.weekNumber === editing) ?? null);

  const review = view.review;
  const inReview = view.state === 'in_review';
  const live = inReview ? (review?.live ?? null) : null;
  // The approver's view (board 5): the live step names this reader.
  const approver = inReview && review?.canDecide === true && live != null;
  const decideLabel = live?.isLast ? 'Approve' : 'Vet';
  const startsOver = view.firstStepLabel
    ? `the ${view.firstStepLabel}`
    : 'the first step';
  const returnWeeks = view.weeks
    .filter((w) => !w.isSurplus)
    .map((w) => ({
      weekNumber: w.weekNumber,
      label: `Week ${w.weekNumber} · ${formatRange(w.startsOn, w.endsOn)}`,
    }));

  async function decide() {
    if (!review) return;
    setDeciding(true);
    await run(
      () =>
        apiFetch<{ message?: string }>(
          `/api/approvals/${review.requestId}/decide`,
          jsonInit('POST', { action: 'approve' })
        ),
      {
        pending: live?.isLast ? 'Approving…' : 'Vetting…',
        // The handler says what the decision did ("Vetted — it's gone to the
        // OIC.", "Approved."), which is better news than a fixed word.
        success: (r) => r?.message ?? (live?.isLast ? 'Approved.' : 'Vetted.'),
        error: (e) => {
          // Somebody else on the step decided first. Theirs stands: say so in
          // the route's words and show the page as it now is.
          if (e instanceof ApiError && e.status === 409) {
            const body = (e.body ?? {}) as { error?: string };
            toast.error('Already decided', {
              description:
                body.error ??
                'Someone on this step decided it a moment ago. The page now shows where it is.',
            });
            void awaitRefresh();
            return null;
          }
          return e instanceof Error ? e.message : 'Could not record that.';
        },
      }
    );
    setDeciding(false);
  }

  async function send() {
    setSending(true);
    await run(
      () =>
        apiFetch<{ stalled: boolean; stalledStep?: string }>(
          `/api/sow/${view.id}/submit`,
          jsonInit('POST', {})
        ),
      {
        pending: 'Sending for review…',
        success: (r) =>
          r.stalled
            ? {
                title: 'Sent for review',
                description: `Waiting — nobody is set for ${r.stalledStep ?? 'the first step'} yet.`,
              }
            : 'Sent for review',
      }
    );
    setSending(false);
  }

  async function deleteWeek(weekNumber: number) {
    setDeleting(weekNumber);
    await run(
      () =>
        apiFetch(`/api/sow/${view.id}/weeks/${weekNumber}`, jsonInit('DELETE')),
      {
        pending: `Deleting Week ${weekNumber}…`,
        success: `Week ${weekNumber} deleted`,
      }
    );
    setDeleting(null);
  }

  return (
    <>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/classroom">Classroom</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              {/* An approver who does not teach it came from their queue. */}
              {approver && !view.teachesIt ? (
                <Link href="/classroom/sow/review">Schemes to review</Link>
              ) : (
                <Link href={`/classroom/sow?term=${d.termNumber}`}>
                  My schemes of work
                </Link>
              )}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{sowTitle}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <BookText className="size-5" />
          </div>
          <div className="space-y-2">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Scheme of work · {d.ayCode}
            </p>
            <h1 className="font-serif text-[34px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[38px]">
              {name}
            </h1>
            <p className="text-sm text-ink-3">{meta.join(' · ')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:justify-end">
          <SowStatusBadge
            state={view.state}
            step={live?.label}
            mine={approver}
          />
          {canEdit && (
            <Button variant="outline" onClick={() => setModuleOpen(true)}>
              Edit module details
            </Button>
          )}
          {/* A plain link: the route builds the file and the browser saves it. */}
          <Button variant="outline" asChild>
            <a href={`/api/sow/${view.id}/excel`} download>
              <Download className="size-4" />
              Download Excel
            </a>
          </Button>
          {view.state === 'approved' && view.canReopen && (
            <Button variant="outline" onClick={() => setReopenOpen(true)}>
              <RotateCcw className="size-4" />
              Reopen
            </Button>
          )}
          {approver && (
            <>
              <Button variant="outline" onClick={() => setReturnOpen(true)}>
                <Undo2 className="size-4" />
                Return to teacher
              </Button>
              <Button
                onClick={() => void decide()}
                loading={deciding}
                loadingText={live?.isLast ? 'Approving…' : 'Vetting…'}
              >
                {!deciding && <Check className="size-4" />}
                {decideLabel}
              </Button>
            </>
          )}
          {canEdit && (
            // `canEdit` already means draft or returned, so the button is
            // never offered on a scheme that cannot be sent. A refusal (an
            // empty topic, no steps set up) comes back as the server's
            // sentence in the toast.
            <Button onClick={send} disabled={sending}>
              {returned ? (
                <Undo2 className="size-4" />
              ) : (
                <Send className="size-4" />
              )}
              {returned ? 'Send for review again' : 'Send for review'}
            </Button>
          )}
        </div>
      </header>

      {returned && (
        <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-white shadow-brand-tile">
            <Undo2 className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              Returned with a note
            </p>
            {returnNote && (
              // The approver writes it in the formatting editor, so it is
              // stored HTML; RichText is the one sanitising renderer.
              <RichText
                html={returnNote.note}
                className="text-sm text-foreground"
              />
            )}
            {returnNote?.by && (
              <p className="text-sm text-ink-3">
                Returned by {returnNote.by}
                {returnNote.at ? ` on ${formatMoment(returnNote.at)}` : ''}.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {canEdit
                ? `Make the changes, then send it again. It starts over from ${startsOver}.`
                : `The teacher makes the changes and sends it again. It starts over from ${startsOver}.`}
            </p>
          </div>
        </div>
      )}

      {live?.empty && (
        // KD #196: a step with nobody on it is a stall, and a stall is said
        // out loud — never a request that quietly goes nowhere.
        <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-white shadow-brand-tile">
            <TriangleAlert className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              Waiting — nobody is set for {live.label} yet.
            </p>
            <p className="text-sm text-muted-foreground">
              It can&rsquo;t move on until an SIS administrator adds someone to
              this step in the approval settings.
            </p>
          </div>
        </div>
      )}

      {live && !live.empty && approver && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-indigo-soft/50 bg-accent px-4 py-3 text-sm text-brand-indigo-deep">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Waiting on you
            {live.since ? ` since ${formatMoment(live.since)}` : ''}. Read the
            weeks, then {live.isLast ? 'approve it' : 'vet it'} or return it to
            the teacher with a note.
          </p>
        </div>
      )}

      {live && !live.empty && !approver && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-ink-2">
          <Clock
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <p>
            Waiting on the {live.label}
            {live.since ? ` since ${formatMoment(live.since)}` : ''}.
            {view.teachesIt &&
              " You can't edit it while it's in review. Ask to have it returned if something needs changing."}
          </p>
        </div>
      )}

      {view.state === 'draft' && d.reopened && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-indigo-soft/50 bg-accent px-4 py-3 text-sm text-brand-indigo-deep">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Reopened by {d.reopened.by} on {formatMoment(d.reopened.at)}
            {d.reopened.note ? `: ${d.reopened.note}` : '.'}
          </p>
        </div>
      )}

      {!returned && view.state === 'draft' && d.copiedFrom && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-indigo-soft/50 bg-accent px-4 py-3 text-sm text-brand-indigo-deep">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Copied from <span className="font-semibold">{d.copiedFrom}</span>.
            Week dates and school events are from the {d.ayCode} calendar.
            {canEdit &&
              ' Edit any week with the pencil, then send it for review.'}
          </p>
        </div>
      )}

      {/* Once it has been sent, the ladder sits beside the plan on a wide
          screen (above it on a narrow one) — the weeks are what an approver
          reads, so they keep the width. */}
      <div
        className={
          review
            ? 'grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start'
            : 'space-y-6'
        }
      >
        {review && (
          <Card className="gap-4 xl:sticky xl:top-20 xl:order-last">
            <CardHeader className="gap-1">
              <CardTitle className="font-serif text-xl font-semibold tracking-tight">
                Approval
              </CardTitle>
              <p className="text-[13px] text-muted-foreground">
                Sent{review.sentBy ? ` by ${review.sentBy}` : ''} on{' '}
                {formatMoment(review.sentAt)}
              </p>
            </CardHeader>
            <CardContent>
              <ApprovalStepRail
                stages={review.stages}
                peopleByStageOrder={review.peopleByStageOrder}
                decidedByNames={review.decidedByNames}
                subjectNoun="scheme of work"
              />
            </CardContent>
          </Card>
        )}
        <div className="min-w-0 space-y-6">
          <ModuleDetails module={view.module} />

          {/* Approved: the weeks ARE the weekly check (board 7). Being
              revised after a reopen: the check keeps running on the last
              approved plan, above the working copy being edited. */}
          {view.checking && (
            <WeekChecks
              sowId={view.id}
              checking={view.checking}
              revising={view.state !== 'approved'}
            />
          )}

          {(view.state !== 'approved' || !view.checking) && (
            <WeekList
              weeks={view.weeks}
              breaks={view.breaks}
              canEdit={canEdit}
              returnWeekNumber={returnNote?.weekNumber ?? null}
              currentWeekNumber={view.thisWeekNumber}
              onEdit={setEditing}
              onDelete={deleteWeek}
              deleting={deleting}
            />
          )}
        </div>
      </div>

      {approver && review && (
        <ReturnSowDialog
          open={returnOpen}
          onOpenChange={setReturnOpen}
          requestId={review.requestId}
          weeks={returnWeeks}
          firstStepLabel={view.firstStepLabel}
        />
      )}
      {view.state === 'approved' && view.canReopen && (
        <ReopenSowDialog
          open={reopenOpen}
          onOpenChange={setReopenOpen}
          sowId={view.id}
        />
      )}

      {canEdit && (
        <>
          <EditWeekSheet
            sowId={view.id}
            week={editingWeek}
            title={sowTitle}
            returnNote={
              returnNote && returnNote.weekNumber === editing
                ? returnNote.note
                : null
            }
            onOpenChange={(open) => !open && setEditing(null)}
          />
          <EditModuleSheet
            open={moduleOpen}
            onOpenChange={setModuleOpen}
            sowId={view.id}
            module={view.module}
            updatedAt={view.updatedAt}
            title={sowTitle}
          />
        </>
      )}
    </>
  );
}

function ModuleDetails({ module }: { module: Record<string, unknown> }) {
  const value = (k: string) =>
    typeof module[k] === 'string' && (module[k] as string).trim() !== ''
      ? (module[k] as string)
      : null;
  const hours = value('hoursPerWeek');
  const summary = [
    hours ? `${hours} hrs/week` : null,
    value('textbook'),
  ].filter(Boolean);
  const filled = MODULE_FIELDS.filter((f) => value(f.key));

  return (
    <Card className="gap-0 py-0">
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-xl px-5 py-4 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="font-semibold text-foreground">Module details</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {summary.length > 0
              ? `· ${summary.join(' · ')}`
              : '· Not filled in yet'}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {filled.length === 0 ? (
            <p className="px-5 pb-4 text-[13px] text-muted-foreground">
              Nothing written here yet.
            </p>
          ) : (
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 border-t border-border px-5 py-4 text-[13px] sm:grid-cols-2">
              {filled.map((f) => (
                <div key={f.key}>
                  <dt className="font-semibold text-foreground">{f.label}</dt>
                  <dd className="whitespace-pre-line text-ink-2">
                    {value(f.key)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
