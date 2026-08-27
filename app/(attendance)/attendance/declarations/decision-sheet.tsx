'use client';

import { useState } from 'react';
import {
  CalendarCheck,
  Check,
  ExternalLink,
  FileText,
  Link2,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { apiFetch } from '@/lib/query/fetcher';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { APPROVAL_NOTE_MAX } from '@/lib/schemas/approval-flows';
import { cn } from '@/lib/utils';
import type { DeclarationQueueRow } from './declarations-data-table';
import {
  formatDayRange,
  formatDecidedAt,
  formatFiledAt,
} from '@/lib/declarations/format';

// Everything the parent sent, and the decision.
//
// ⚠ THIS SHOWS THE WHOLE FILING, DELIBERATELY AND IN FULL. Nobody can approve
// what they cannot read. Both approvers see the same thing — the officer in
// charge decides the same filing the adviser did, from the same evidence.
//
// ⚠ WHAT IS WITHHELD IS WITHHELD FROM THE AUDIT LOG, NOT FROM THE READER. The
// parent's note never reaches `audit_log`, because that is read by every
// registrar-and-above user, is append-only and can never be corrected
// (migration 109's rule, restated by 125 and 126). The person deciding is a
// different audience and reads it here in full.
//
// ⚠ `SheetContent` IS NOT A FLEX COLUMN. Its variants are a plain block with
// `h-full`, so `flex-1 min-h-0 overflow-y-auto` on the body is inert unless the
// panel itself is told to be a column. Three sheets in components/classroom/
// were broken this way for weeks; nothing in them was tall enough to prove it
// until a form with a real amount of content arrived. This one has a lot of
// content, so it passes `flex flex-col` explicitly.

export function DeclarationDecisionSheet({
  row,
  onOpenChange,
}: {
  row: DeclarationQueueRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={row !== null} onOpenChange={onOpenChange}>
      {/* ⚠ KEYED BY THE FILING, so opening a second one starts clean. A note is
          about ONE decision; carrying it across would attach a sentence to a
          decision it was never written for. A key does that by construction —
          an effect that resets state is a cascading render and the linter
          rightly refuses it. */}
      {row && (
        <DecisionPanel key={row.id} row={row} onOpenChange={onOpenChange} />
      )}
    </Sheet>
  );
}

function DecisionPanel({
  row,
  onOpenChange,
}: {
  row: DeclarationQueueRow;
  onOpenChange: (open: boolean) => void;
}) {
  const run = useWriteAction();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  const d = row.detail;
  const isTravel = d.declarationType === 'travel';

  async function decide(action: 'approve' | 'reject') {
    setBusy(action);
    await run(
      () =>
        apiFetch<{ message: string }>(
          `/api/approvals/${row.requestId}/decide`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action,
              note: note.trim() || undefined,
            }),
          }
        ),
      {
        pending: action === 'approve' ? 'Approving…' : 'Turning it down…',
        success: (data) => data.message,
        onResolved: () => onOpenChange(false),
      }
    );
    setBusy(null);
  }

  return (
    <SheetContent
      side="right"
      className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
    >
      <SheetHeader className="border-b border-border px-6 py-5">
        <p className="font-mono text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {isTravel ? 'Travel declaration' : 'Absence declaration'}
        </p>
        <SheetTitle className="font-serif text-[22px] font-semibold tracking-tight">
          {d.studentName}
        </SheetTitle>
        <SheetDescription>
          {[d.className, d.studentNumber].filter(Boolean).join(' · ')}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {/* ── What the parent said ─────────────────────────────────── */}
        <section className="space-y-3">
          <SectionLabel>What the parent told the school</SectionLabel>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="Days away">
              <span className="tabular-nums">
                {formatDayRange(d.startDate, d.endDate)}
              </span>
              <span className="text-muted-foreground">
                {' '}
                · {d.dayCount === 1 ? '1 day' : `${d.dayCount} days`}
              </span>
            </Detail>

            {isTravel ? (
              <Detail label="Where">
                {[d.destinationCity, d.destinationCountry]
                  .filter(Boolean)
                  .join(', ') || '—'}
              </Detail>
            ) : (
              <Detail label="Medical certificate">
                {d.withMedical ? 'Yes, attached' : 'No certificate'}
              </Detail>
            )}

            {/* ⚠ The allowance INFORMS the approver; it never blocks anyone.
                Mr Ace, 2026-08-27: warn the approver, never block the parent.
                The approval steps exist precisely so a person makes this call,
                and a family with a real reason for a second trip must be able
                to ask. `used` excludes this filing, so +1 is what saying yes
                would make it. */}
            {isTravel && d.vacationUsage && (
              <Detail label="Vacation leave">
                <span
                  className={cn(
                    d.vacationUsage.used + 1 > d.vacationUsage.allowance &&
                      'font-semibold text-brand-amber'
                  )}
                >
                  {d.vacationUsage.used + 1 > d.vacationUsage.allowance
                    ? `This would be trip ${d.vacationUsage.used + 1} of ${d.vacationUsage.allowance} allowed this term`
                    : `Trip ${d.vacationUsage.used + 1} of ${d.vacationUsage.allowance} this term`}
                </span>
              </Detail>
            )}

            <Detail label="Filed by">{d.filedByEmail}</Detail>
            <Detail label="Filed on">{formatFiledAt(d.filedAt)}</Detail>
          </dl>
        </section>

        {/* ── The certificate ──────────────────────────────────────── */}
        {!isTravel && (d.evidenceUrl || d.evidenceLinkUrl) && (
          <section className="space-y-3">
            <SectionLabel>The certificate</SectionLabel>
            <div className="space-y-2">
              {d.evidenceUrl && (
                <EvidenceLink
                  href={d.evidenceUrl}
                  icon={FileText}
                  title="Open the file the parent uploaded"
                  detail="Opens in a new tab."
                />
              )}
              {d.evidenceLinkUrl && (
                <EvidenceLink
                  href={d.evidenceLinkUrl}
                  icon={Link2}
                  title="Open the parent's link"
                  detail="This is the parent's own link, not a copy the school holds. If it no longer opens, ask them for the certificate."
                />
              )}
            </div>
          </section>
        )}

        {/* ── The parent's note ────────────────────────────────────── */}
        {d.parentNote && (
          <section className="space-y-3">
            <SectionLabel>Note from the parent</SectionLabel>
            <p className="rounded-lg border border-border bg-muted/40 p-4 text-[14px] leading-relaxed whitespace-pre-wrap text-foreground">
              {d.parentNote}
            </p>
          </section>
        )}

        {/* ── Siblings ─────────────────────────────────────────────── */}
        {d.siblings.length > 0 && (
          <section className="space-y-3">
            <SectionLabel>Also on this form</SectionLabel>
            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
              <Users
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <div className="space-y-1 text-[14px]">
                <p className="text-foreground">
                  {d.siblings
                    .map((s) =>
                      s.className
                        ? `${s.studentName} (${s.className})`
                        : s.studentName
                    )
                    .join(', ')}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  The parent sent one form for all of them. Each child is
                  decided by their own class&apos;s adviser, so approving this
                  one does not decide the others.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ── The steps ────────────────────────────────────────────── */}
        <section className="space-y-3">
          <SectionLabel>Where this has got to</SectionLabel>
          <ol className="space-y-0">
            {(d.ladder?.stages ?? []).map((stage, index, all) => {
              const decided =
                stage.status === 'approved' || stage.status === 'rejected';
              const people = row.peopleByStageOrder[stage.stageOrder];
              return (
                <li key={stage.stageOrder} className="flex gap-3">
                  {/* The rail: a real sequence, so a real line. */}
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-[11px] font-semibold tabular-nums',
                        stage.status === 'approved' &&
                          'bg-brand-mint/30 text-ink',
                        stage.status === 'rejected' &&
                          'bg-destructive/10 text-destructive',
                        stage.status === 'pending' &&
                          'bg-accent text-accent-foreground',
                        stage.status === 'waiting' &&
                          'bg-muted text-muted-foreground'
                      )}
                    >
                      {stage.status === 'approved' ? (
                        <Check className="size-3.5" aria-hidden />
                      ) : stage.status === 'rejected' ? (
                        <X className="size-3.5" aria-hidden />
                      ) : (
                        stage.stageOrder
                      )}
                    </span>
                    {index < all.length - 1 && (
                      <span
                        className="my-1 w-px flex-1 bg-border"
                        aria-hidden
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 pb-5">
                    <p className="text-[14px] font-medium text-foreground">
                      {stage.label}
                    </p>
                    {decided ? (
                      <p className="text-[13px] text-muted-foreground">
                        {stage.status === 'approved'
                          ? 'Approved'
                          : 'Turned down'}{' '}
                        by {row.decidedByNames[stage.stageOrder] ?? 'someone'} ·{' '}
                        {formatDecidedAt(stage.decidedAt)}
                      </p>
                    ) : stage.resolver === 'form_adviser' ? (
                      <p className="text-[13px] text-muted-foreground">
                        Whoever advises the class, including anyone covering it
                        this week.
                      </p>
                    ) : people ? (
                      <p className="text-[13px] text-muted-foreground">
                        {people}
                      </p>
                    ) : (
                      // ⚠ The live case today: nobody holds the officer-in-
                      // charge post yet, so this step really will stall. Say
                      // so here rather than let a filing appear to vanish.
                      <p className="text-[13px] text-destructive">
                        Nobody has been added to this step yet, so it will stop
                        here.
                      </p>
                    )}
                    {stage.decisionNote && (
                      <p className="mt-1.5 text-[13px] leading-relaxed text-foreground italic">
                        “{stage.decisionNote}”
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* ── What it did to the attendance sheet ──────────────────── */}
        <RegisterOutcome d={d} />

        {/* ── The note ─────────────────────────────────────────────── */}
        {row.canDecide && (
          <Field>
            <FieldLabel htmlFor="decision-note">
              Add a note (optional)
            </FieldLabel>
            <Textarea
              id="decision-note"
              value={note}
              maxLength={APPROVAL_NOTE_MAX}
              rows={3}
              placeholder="Anything the next person, or the office, should know."
              onChange={(e) => setNote(e.target.value)}
            />
            <FieldDescription>
              The parent does not see this. It stays on the request for whoever
              reads it next.
            </FieldDescription>
          </Field>
        )}
      </div>

      <SheetFooter className="border-t border-border px-6 py-4">
        {row.canDecide ? (
          <div className="flex w-full items-center justify-end gap-2">
            <Button
              variant="destructive"
              onClick={() => decide('reject')}
              loading={busy === 'reject'}
              loadingText="Turning it down…"
              disabled={busy !== null}
            >
              Turn down
            </Button>
            <Button
              onClick={() => decide('approve')}
              loading={busy === 'approve'}
              loadingText="Approving…"
              disabled={busy !== null}
            >
              Approve
            </Button>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            This one is with{' '}
            {row.peopleByStageOrder[row.stageOrder] || 'someone else'}. You can
            read it, but it is not yours to decide.
          </p>
        )}
      </SheetFooter>
    </SheetContent>
  );
}

/**
 * What the final approval did to the attendance sheet (Phase 3).
 *
 * Deliberately the SAME block shape as "Also on this form" above — an icon,
 * a sentence, a line of detail — with only the colour family swapped per the
 * design system's §9.3 severity recipes. A new visual device here would be
 * noise: this is the last line of a story the step rail above already tells,
 * not a headline of its own.
 *
 * Renders nothing until there is something to report, which is why a travel
 * filing and an in-progress absence both show no block at all rather than an
 * empty state saying "not yet".
 */
function RegisterOutcome({ d }: { d: DeclarationQueueRow['detail'] }) {
  if (d.status !== 'approved') return null;
  // ⚠ Travel is INCLUDED as of Phase 4 — it marks the register too, with a
  // different reason. It was excluded while it marked nothing.
  const isTravel = d.declarationType === 'travel';

  const failed = d.registerWriteError != null;
  const days = d.registerDaysWritten ?? 0;
  const marked = !failed && d.registerWrittenAt != null;

  // Approved, absence, no stamp and no recorded error: the write has not been
  // attempted yet (approved before this shipped). The repair script picks
  // these up, and the reader needs to know the sheet is not marked.
  const pending = !failed && !marked;

  const tone = failed || pending ? 'blocked' : 'done';

  return (
    <section className="space-y-3">
      <SectionLabel>The attendance sheet</SectionLabel>
      <div
        className={cn(
          'flex items-start gap-3 rounded-lg border p-4',
          tone === 'done'
            ? 'border-brand-mint bg-brand-mint/20'
            : 'border-destructive/40 bg-destructive/5'
        )}
      >
        {tone === 'done' ? (
          <CalendarCheck
            className="mt-0.5 size-4 shrink-0 text-ink"
            aria-hidden
          />
        ) : (
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-destructive"
            aria-hidden
          />
        )}
        <div className="space-y-1 text-[14px]">
          <p
            className={cn(
              'font-medium',
              tone === 'done' ? 'text-ink' : 'text-destructive'
            )}
          >
            {failed
              ? 'The register was not marked'
              : pending
                ? 'The register has not been marked yet'
                : days === 0
                  ? 'No school days to mark'
                  : `${days} ${days === 1 ? 'day' : 'days'} marked as excused`}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {failed
              ? 'The approval stands — only the register is behind. Tell an administrator; the days can be marked without anyone approving this again.'
              : pending
                ? 'This was approved before the register was marked automatically. Tell an administrator so the days can be added.'
                : days === 0
                  ? 'Every date the parent gave falls on a weekend, a holiday, or outside the school year, so nothing on the register changed.'
                  : isTravel
                    ? 'The register shows these days as excused, reason “Vacation leave”, and the trip counts against this term’s allowance. Weekends and holidays inside the dates were left alone.'
                    : 'The register shows these days as excused, reason “MC / Excuse leave”. Weekends and holidays inside the dates were left alone.'}
          </p>
        </div>
      </div>
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
      {children}
    </p>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-[14px] text-foreground">{children}</dd>
    </div>
  );
}

function EvidenceLink({
  href,
  icon: Icon,
  title,
  detail,
}: {
  href: string;
  icon: typeof FileText;
  title: string;
  detail: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-brand-indigo" aria-hidden />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-1.5 text-[14px] font-medium text-foreground">
          {title}
          <ExternalLink className="size-3 text-muted-foreground" aria-hidden />
        </span>
        <span className="block text-[13px] leading-relaxed text-muted-foreground">
          {detail}
        </span>
      </span>
    </a>
  );
}
