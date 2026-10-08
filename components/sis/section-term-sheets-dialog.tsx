'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  ArrowUpRight,
  Lock,
  LockOpen,
  Pencil,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { LockToggle } from '@/components/grading/lock-toggle';
import { SwitchSheetTypeButton } from '@/components/grading/switch-sheet-type-button';
import { TotalsEditor } from '@/components/grading/totals-editor';
import { RowActionsMenu } from '@/components/ui/data-table/row-actions-menu';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  SHEET_TYPE_LABEL,
  type SheetType,
} from '@/lib/grading/term4-framework';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiFetch } from '@/lib/query/fetcher';

// One class's four terms, each opening the grading sheet editor that ALREADY
// EXISTS.
//
// ⚠ THIS DELIBERATELY CONTAINS NO EDITOR. `components/grading/totals-editor.tsx`
// already does every per-sheet config — WW/PT slots with each one's max, the
// exam max, the component chips that take the exam off a term (migration 159 /
// KD #218), and the post-lock correction path. Building a second one is how
// the two drift apart, and it is what the first attempt at this did.
//
// The only thing missing was REACH. Subject setup's class chips carry one
// `sheetId` — "the current term's, else the latest that exists" — so three of
// a class's four terms could not be opened from that screen at all. Measured
// 2026-09-23: 123 of 125 AY2026 class+subject pairs carry all four terms, and
// a sampled class is marked out of 20 in T1/T2 and out of 10 in T3/T4.

type TermRow = {
  termId: string;
  termNumber: number;
  label: string;
  sheetId: string | null;
  isLocked: boolean;
  sheetType: SheetType;
  /** What this sheet can switch to, or null (only Secondary Four offers it). */
  switchTo: SheetType | null;
  studentsWithScores: number;
  wwTotals: number[];
  ptTotals: number[];
  qaTotal: number | null;
  weights: { ww: number; pt: number; qa: number };
  weightsOverridden: boolean;
};

type Payload = {
  section: {
    id: string;
    name: string;
    levelCode: string | null;
    levelLabel: string | null;
  };
  subject: { code: string; name: string; isExaminable: boolean };
  limits: { wwMaxSlots: number; ptMaxSlots: number };
  subjectWeights: { ww: number; pt: number; qa: number };
  terms: TermRow[];
};

export function SectionTermSheetsDialog({
  sheetId,
  sectionName,
  open,
  onOpenChange,
}: {
  /** Any one of the class's sheets for this subject — the route finds the rest. */
  sheetId: string;
  sectionName: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['section-term-sheets', sheetId];

  const { data, isPending, isError, error, refetch } = useQuery<Payload>({
    queryKey,
    queryFn: () =>
      apiFetch<Payload>(`/api/grading-sheets/${sheetId}/section-terms`),
    enabled: open,
  });

  const terms = Array.isArray(data?.terms) ? data.terms : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            {sectionName}
          </DialogTitle>
          <DialogDescription>
            {data
              ? `${data.subject.name} — pick a term to set its slots and max scores.`
              : 'Pick a term to set its slots and max scores.'}
          </DialogDescription>
        </DialogHeader>

        {isPending ? (
          <div className="space-y-1.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        ) : isError || !terms ? (
          <LoadFailed error={error} onRetry={() => void refetch()} />
        ) : terms.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            This academic year has no terms set up yet.
          </p>
        ) : (
          <div className="space-y-1">
            {terms.map((term) => (
              <TermSheetRow
                key={term.termId}
                term={term}
                data={data}
                onChanged={() =>
                  void queryClient.invalidateQueries({ queryKey })
                }
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// One term. ONE visible action — View sheet — and everything that changes the
// sheet lives in the ⋯ menu (Mr Ace, 2026-10-08: four buttons in a line was
// too many). Each menu item only raises state; the editor, the lock confirm
// and the switch confirm stay mounted here with their own buttons hidden, so a
// dialog never opens from inside the closing menu.
function TermSheetRow({
  term,
  data,
  onChanged,
}: {
  term: TermRow;
  data: Payload;
  /** `onDone` matters: this list is TanStack Query, so the `router.refresh()`
      the lock and switch already do cannot reach it, and the row would keep
      saying "Locked" / the old sheet type. */
  onChanged: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);

  const sheetId = term.sheetId;
  const isFramework = term.sheetType === 'term4_framework';
  const switchTo = term.switchTo;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-2 py-2">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-ink-2">
          Term {term.termNumber}
        </span>
        {isFramework && (
          <Badge
            variant="outline"
            className="h-5 border-brand-indigo/30 bg-brand-indigo/10 text-brand-indigo-deep"
          >
            {SHEET_TYPE_LABEL.term4_framework}
          </Badge>
        )}
        {term.isLocked && (
          <Badge
            variant="outline"
            className="h-5 border-destructive/40 bg-destructive/10 text-destructive"
          >
            <Lock className="size-3" />
            Locked
          </Badge>
        )}
      </span>

      {sheetId == null ? (
        <span className="text-[12px] text-muted-foreground">No sheet yet</span>
      ) : (
        <span className="flex items-center gap-1">
          {/* Straight to the sheet in Markbook, to see the marks themselves. */}
          <Button asChild variant="ghost" size="sm">
            <Link href={`/markbook/grading/${sheetId}`}>
              <ArrowUpRight className="size-3.5" />
              View sheet
            </Link>
          </Button>

          <RowActionsMenu>
            {/* A framework sheet has fixed columns, so its slots and max
                scores are not editable (the sheet page hides the editor too). */}
            {!isFramework && (
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <Pencil className="size-4" />
                Set slots &amp; max scores
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setLockOpen(true)}>
              {term.isLocked ? (
                <LockOpen className="size-4" />
              ) : (
                <Lock className="size-4" />
              )}
              {term.isLocked ? 'Unlock sheet' : 'Lock sheet'}
            </DropdownMenuItem>
            {switchTo && (
              <DropdownMenuItem onSelect={() => setSwitchOpen(true)}>
                <ArrowLeftRight className="size-4" />
                Switch to {SHEET_TYPE_LABEL[switchTo]}
              </DropdownMenuItem>
            )}
          </RowActionsMenu>

          {!isFramework && (
            <TotalsEditor
              hideTrigger
              open={editOpen}
              onOpenChange={setEditOpen}
              sheetId={sheetId}
              wwTotals={term.wwTotals}
              ptTotals={term.ptTotals}
              qaTotal={term.qaTotal}
              wwMaxSlots={data.limits.wwMaxSlots}
              ptMaxSlots={data.limits.ptMaxSlots}
              isLocked={term.isLocked}
              weights={term.weights}
              subjectWeights={data.subjectWeights}
              weightsOverridden={term.weightsOverridden}
            />
          )}
          <LockToggle
            hideTrigger
            confirmOpen={lockOpen}
            onConfirmOpenChange={setLockOpen}
            sheetId={sheetId}
            isLocked={term.isLocked}
            onDone={onChanged}
          />
          {switchTo && (
            <SwitchSheetTypeButton
              hideTrigger
              open={switchOpen}
              onOpenChange={setSwitchOpen}
              sheetId={sheetId}
              to={switchTo}
              studentsWithScores={term.studentsWithScores}
              onDone={onChanged}
            />
          )}
        </span>
      )}
    </div>
  );
}

function LoadFailed({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const reason =
    error instanceof ApiError
      ? error.status === 401
        ? 'Your session has expired — sign in again.'
        : error.status === 403
          ? 'Your account can’t change grading sheets.'
          : error.message
      : error instanceof Error
        ? error.message
        : null;

  return (
    <div className="space-y-1.5 text-[12px] text-muted-foreground">
      <p>
        Couldn&rsquo;t load this class&rsquo;s terms.
        {reason ? ` ${reason}` : ''}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7"
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}
