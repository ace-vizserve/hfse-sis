'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import { AssessmentScoreField } from '@/components/sis/assessment-score-field';
import { LateEnrolleePrompt } from '@/components/sis/late-enrollee-prompt';
import type { MidTermPayload } from '@/lib/sis/placement-completion';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import {
  APPLICATION_TERMINAL_REASON_VALUES,
  APPLICATION_TERMINAL_REASON_LABELS,
  APPLICATION_TERMINAL_STATUSES,
  ENROLLED_PREREQ_STAGES,
  STAGE_COLUMN_MAP,
  STAGE_LABELS,
  STAGE_STATUS_OPTIONS,
  STAGE_TERMINAL_STATUS,
  StageUpdateSchema,
  checkStageScoreExtras,
  findStageCompletionBlockers,
  isStageStatusMissing,
  stageCompletionMessage,
  stageStatusMissingMessage,
  type ApplicationTerminalReason,
  type StageKey,
  type StageUpdateInput,
} from '@/lib/schemas/sis';

const OTHER_SENTINEL = '__other__';

type ExtraValues = Record<string, string | null>;

export function EditStageDialog({
  ayCode,
  enroleeNumber,
  stageKey,
  initialStatus,
  initialRemarks,
  initialExtras,
  prereqStatuses,
}: {
  ayCode: string;
  enroleeNumber: string;
  stageKey: StageKey;
  initialStatus: string | null;
  initialRemarks: string | null;
  initialExtras: ExtraValues;
  /**
   * Current statuses for the 5 ENROLLED_PREREQ_STAGES. Optional — when
   * provided AND `stageKey === 'application'` AND the user changes the status
   * to plain `Enrolled` (from anything else), the dialog lists the steps still
   * open and asks the person to tick
   * "Enrol anyway" before saving (2026-09-28). The server re-checks and 422s
   * unless that acknowledgement is sent.
   */
  prereqStatuses?: Partial<Record<StageKey, string | null>>;
}) {
  const [open, setOpen] = useState(false);
  const [pendingMidTerm, setPendingMidTerm] = useState<MidTermPayload | null>(
    null
  );

  const cols = STAGE_COLUMN_MAP[stageKey];
  const canonicalOptions = STAGE_STATUS_OPTIONS[stageKey];

  // Two state pieces: the dropdown choice (canonical OR sentinel) and the
  // free-text override when the user picks "Other". This avoids round-tripping
  // through the form's `status` field on every keystroke.
  const initialIsCanonical =
    initialStatus !== null &&
    (canonicalOptions as readonly string[]).includes(initialStatus);
  const [statusChoice, setStatusChoice] = useState<string>(
    initialStatus === null
      ? ''
      : initialIsCanonical
        ? initialStatus
        : OTHER_SENTINEL
  );
  const [statusOther, setStatusOther] = useState<string>(
    initialStatus !== null && !initialIsCanonical ? initialStatus : ''
  );

  const form = useForm<StageUpdateInput>({
    resolver: zodResolver(StageUpdateSchema),
    defaultValues: {
      status: initialStatus,
      remarks: initialRemarks,
      extras: cols.extras.reduce<ExtraValues>((acc, e) => {
        acc[e.fieldKey] = initialExtras[e.fieldKey] ?? null;
        return acc;
      }, {}),
    },
  });

  // Keep form.status in sync with the dropdown + Other input.
  useEffect(() => {
    if (statusChoice === '') {
      form.setValue('status', null, { shouldDirty: true });
    } else if (statusChoice === OTHER_SENTINEL) {
      form.setValue('status', statusOther.trim() ? statusOther : null, {
        shouldDirty: true,
      });
    } else {
      form.setValue('status', statusChoice, { shouldDirty: true });
    }
  }, [statusChoice, statusOther, form]);

  // Resolve the checklist's effective status from the same dropdown/free-text
  // pair the form watches, so the checklist responds the moment the admin
  // picks "Enrolled" — no submit round-trip required.
  const effectiveStatus =
    statusChoice === ''
      ? null
      : statusChoice === OTHER_SENTINEL
        ? statusOther.trim() || null
        : statusChoice;
  const showPrereqChecklist =
    stageKey === 'application' &&
    !!prereqStatuses &&
    (effectiveStatus === 'Enrolled' ||
      effectiveStatus === 'Enrolled (Conditional)');
  const prereqRows = showPrereqChecklist
    ? // Only the stages the caller passed: a Current child's list has no
      // Assessment (`enrolledPrereqStagesFor`), and listing it here would
      // warn about a step the save does not require.
      ENROLLED_PREREQ_STAGES.filter((k) =>
        Object.hasOwn(prereqStatuses ?? {}, k)
      ).map((k) => {
        const current = prereqStatuses?.[k] ?? null;
        const expected = STAGE_TERMINAL_STATUS[k] ?? '';
        return { key: k, current, expected, ok: current === expected };
      })
    : [];

  // ⚠ NO CLASS IS GIVEN HERE (2026-09-28, Mr Ace: "its unnecessary to be in
  // there"). This dialog used to carry an optional class picker on the
  // Enrolled flip. Classes are now given only on the Class Assignment card of
  // the Enrollment tab — "Assign a class" once Enrolled, "Change section"
  // once in a class (KD #226) — so enrolling here leaves the class to that
  // card. A class already on the row (set in Directus) is still placed by the
  // save, when it can take them; when it can't, the save still enrols and
  // says so (`chosenClassUnavailable`).

  // ⚠ ENROLLED WARNS, IT DOES NOT BLOCK (2026-09-28, Mr Ace). Admissions staff
  // enrol a child before every step is done to secure a class seat — class
  // assignment requires Enrolled (KD #226). So plain Enrolled with steps open
  // shows the open steps and a tick-box; ticking it sends
  // `acknowledge_open_steps`, which the route accepts and records on the audit
  // row. The child then sits on Admissions → Enrolled, steps still open until
  // the steps are done. Enrolled (Conditional) never shows this — it skips the
  // gate by design (KD #180), so there is nothing to acknowledge.
  //
  // Only on the change INTO Enrolled. Re-saving an application that is already
  // Enrolled (a remarks edit) asks nothing — the route checks the open steps
  // on the transition only, and the child is already on the chase queue.
  const enrollingNow = initialStatus !== 'Enrolled';
  const openStepRows =
    showPrereqChecklist && effectiveStatus === 'Enrolled' && enrollingNow
      ? prereqRows.filter((r) => !r.ok)
      : [];
  const showOpenStepsWarning =
    stageKey === 'application' && openStepRows.length > 0;
  const [enrolAnyway, setEnrolAnyway] = useState(false);
  useEffect(() => {
    if (!showOpenStepsWarning) setEnrolAnyway(false);
  }, [showOpenStepsWarning]);
  const enrolAnywayConfirmed = showOpenStepsWarning && enrolAnyway;

  const isTerminalStatus = (
    APPLICATION_TERMINAL_STATUSES as readonly string[]
  ).includes(effectiveStatus ?? '');
  // Withdrawing or cancelling the application also takes the child out of
  // their class, and that needs a last day at school. The assignable-sections
  // read answers where a student sits, and whether they sit anywhere at all;
  // only the fields used here are typed.
  const endingApplication = stageKey === 'application' && isTerminalStatus;

  const sectionsQuery = useQuery({
    queryKey: ['assignable-sections', enroleeNumber, ayCode],
    queryFn: () =>
      apiFetch<{
        /** Set when this student already sits in a class this year. */
        currentSection: {
          sectionName: string;
          levelCode: string | null;
          status: string;
        } | null;
        /**
         * Has this student ever been marked present or absent this year?
         * `null` means the read could not tell, and is treated as "yes" —
         * the same fail-closed direction as the server's own gate.
         */
        hasAttendance: boolean | null;
      }>(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/assignable-sections?ay=${encodeURIComponent(ayCode)}`
      ),
    enabled: endingApplication,
  });

  // Where this student already sits, if anywhere. Resolved server-side by the
  // query above rather than threaded in as a prop — the roster is the only
  // thing that knows, and a prop would be stale by the time the dialog opens.
  const alreadyPlaced = sectionsQuery.data?.currentSection ?? null;

  // The two dates the school keeps when a child leaves (migration 163) — the
  // same pair, in the same words, as the withdrawal on the class roster
  // (components/sis/enrolment-edit-sheet.tsx). The server used to stamp today
  // here instead, which recorded when someone clicked, not when the child left.
  const [lastDay, setLastDay] = useState('');
  const [approvedDate, setApprovedDate] = useState('');
  // The server's answer wins over the class read above: a transferred student
  // holds two class rows, and that read looks at only one of them.
  const [serverNeedsLastDay, setServerNeedsLastDay] = useState(false);
  const placedInClassNow =
    alreadyPlaced?.status === 'active' ||
    alreadyPlaced?.status === 'late_enrollee';

  // ⚠ A CLASS ROW IS NOT ATTENDANCE. Mr Ace, 2026-09-22: this form demanded
  // "the last day they actually attended" from a student whose application
  // still read Submitted — "this doesnt make sense bruh". All 15 AY2026
  // students who hit it are in YS Youngstarters, a section with a full roster
  // and ZERO attendance marks, so the one date the form insisted on was the
  // one nobody could answer. `null` (the read could not tell) counts as
  // attended, matching the server's fail-closed gate.
  const hasAttendance = sectionsQuery.data?.hasAttendance ?? null;
  const neverAttended = hasAttendance === false;

  // Offered whenever they sit in a class; REQUIRED only when there is a
  // register behind it. The server enforces the same split, so an empty date
  // for a never-attended student is now accepted rather than refused.
  const lastDayOffered =
    endingApplication && (placedInClassNow || serverNeedsLastDay);
  const lastDayRequired = lastDayOffered && !neverAttended;

  const [terminalReason, setTerminalReason] = useState<
    ApplicationTerminalReason | ''
  >(
    (initialExtras?.terminalReason as ApplicationTerminalReason | undefined) ??
      ''
  );
  const [terminalNotes, setTerminalNotes] = useState(
    (initialExtras?.terminalNotes as string | undefined) ?? ''
  );

  useEffect(() => {
    if (!isTerminalStatus) {
      setTerminalReason('');
      setTerminalNotes('');
      setLastDay('');
      setApprovedDate('');
      setServerNeedsLastDay(false);
    }
  }, [isTerminalStatus]);

  // ── Stage completion gate ────────────────────────────────────────────────
  //
  // Some statuses can't stand on their own: "Paid" with no invoice number,
  // "Finished" with no assessment marks. STAGE_STATUS_REQUIRED_FIELDS names
  // which, and the stage PATCH route refuses a save that lands there — so this
  // dialog reads THE SAME MAP and says so before the save, rather than letting
  // someone fill the form in and collect a refusal.
  //
  // `watch` (not `getValues`) so the notice clears the moment the missing box
  // is typed into.
  const watchedExtras = form.watch('extras');

  // The row as it will stand AFTER the save — which is what the server checks,
  // because it merges the incoming values over the stored row. Built in the
  // same order onSubmit builds `extrasPayload`: stored row, this form's values
  // over it, then the terminal reason/notes the application stage keeps in
  // component state rather than in the form. Any other order and the dialog
  // could disagree with the route, which would show Save as available and then
  // have it refused.
  const effectiveExtras: Record<string, string | null | undefined> = {
    ...initialExtras,
    ...(watchedExtras ?? {}),
    ...(stageKey === 'application' && isTerminalStatus
      ? {
          terminalReason: terminalReason || undefined,
          terminalNotes: terminalNotes.trim() || undefined,
        }
      : {}),
  };

  // A stage saved with no status stamps who-and-when onto a row that still
  // says nothing, so the record reads as worked when it is empty. Same rule as
  // the route, read from the same helper so the two cannot drift.
  const statusMissing = isStageStatusMissing(stageKey, effectiveStatus);

  // Score extras (the assessment grades): the same rule the route applies,
  // judged against the stored row so an untouched legacy grade passes. Each
  // field shows its own message; this only keeps Save shut while one stands.
  const scoreCheck = checkStageScoreExtras(
    cols,
    watchedExtras ?? undefined,
    Object.fromEntries(
      cols.extras.map((e) => [e.columnName, initialExtras[e.fieldKey] ?? null])
    )
  );

  const completionBlockers = findStageCompletionBlockers(
    stageKey,
    effectiveStatus,
    effectiveExtras
  );

  // On the application stage's Cancelled / Withdrawn path the block further
  // down is already the gate for exactly this — in more specific words, and
  // owning the controls that actually write the reason (the Stage details
  // inputs for it are overwritten by that block on submit). Printing a second
  // red sentence beside it would read as two mechanisms rather than one, so
  // the general notice stands aside there. Save stays blocked either way: the
  // footer's condition covers both.
  const terminalBlockOwnsTheGate =
    stageKey === 'application' && isTerminalStatus;
  const showCompletionNotice =
    completionBlockers.length > 0 && !terminalBlockOwnsTheGate;
  const completionMessage = showCompletionNotice
    ? stageCompletionMessage(
        stageKey,
        effectiveStatus ?? '',
        completionBlockers
      )
    : '';
  // Which boxes to mark. The sentence says what is missing; the marker says
  // where, and both come and go as the status changes.
  const blockedFieldKeys = new Set(
    showCompletionNotice ? completionBlockers.map((b) => b.fieldKey) : []
  );

  type StageResponse = {
    changed?: number;
    classAutoAssigned?: boolean;
    awaitingPlacement?: boolean;
    /** Enrolled with these steps still open ("Enrol anyway"). */
    openSteps?: string[];
    /**
     * Enrolled, but the class already on the row (set in Directus) can't take
     * them — gone or full — so they were not placed. `reason` is a sentence.
     */
    chosenClassUnavailable?: { chosenClass: string; reason: string } | null;
    autoSync?: { change?: string; reason?: string; error?: string };
    autoSyncFailed?: boolean;
    withdrawalCascade?: {
      rowsAffected: number;
      sectionStudentIds: string[];
    } | null;
    /** Application saved, but the class roster could not be updated. */
    withdrawalCascadeFailed?: { error: string } | null;
    midTermEnrolment?: MidTermPayload | null;
  };

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<StageResponse>(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/stage/${stageKey}?ay=${encodeURIComponent(ayCode)}`,
        jsonInit('PATCH', payload)
      ),
  });

  const run = useWriteAction();

  /**
   * Words the outcome. Returns a plain string for the simple cases and `null`
   * for the two that need a toast this helper cannot build — a WARNING (the
   * sync was skipped, which is not a success) and a success carrying a
   * `description`. Both raise their own toast and return null so exactly one
   * lands.
   */
  function describeSuccess(body: StageResponse): string | null {
    const changed = body.changed as number | undefined;
    const classAutoAssigned = body.classAutoAssigned === true;
    const autoSync = body.autoSync;
    const autoSyncFailed = body.autoSyncFailed === true;
    const withdrawalCascade = body.withdrawalCascade;

    // The application was saved but the class roster was not — the two now
    // disagree, and nothing else on screen would show it.
    if (body.withdrawalCascadeFailed) {
      toast.warning(
        `${STAGE_LABELS[stageKey]} saved, but the student is still on their class list`,
        {
          description:
            'Open the student in Records → Students and withdraw them from their class there.',
        }
      );
      return null;
    }

    // Enrolled, but the class already set for them could not be used, so
    // they are not in a class and the route cleared it from the row. A
    // warning, not a refusal: the enrolment is saved and the class is given on
    // the Class Assignment card.
    if (body.chosenClassUnavailable) {
      const stillOpen =
        body.openSteps && body.openSteps.length > 0
          ? ` Still to finish: ${body.openSteps.join(', ')}.`
          : '';
      toast.warning(
        `Enrolled, but their class (${body.chosenClassUnavailable.chosenClass}) can’t be used`,
        {
          description: `${body.chosenClassUnavailable.reason} It has been taken off their record — give them a class on the Class Assignment card.${stillOpen}`,
        }
      );
      return null;
    }

    // Withdrawn / Cancelled cascade outcome takes priority on the toast.
    // The cascade only fires when the flip actually changed section rows;
    // null means "no active section to withdraw from" (acceptable no-op).
    if (withdrawalCascade && withdrawalCascade.rowsAffected > 0) {
      return `${STAGE_LABELS[stageKey]} updated · ${withdrawalCascade.rowsAffected} section row${
        withdrawalCascade.rowsAffected === 1 ? '' : 's'
      } flipped to withdrawn`;
    } else if (autoSyncFailed) {
      // Either Enrolled (class auto-assigned then sync skipped) OR
      // Enrolled (Conditional) with classSection already set but sync
      // failed for a non-empty reason. Either way the student appears
      // Enrolled in admissions but is missing from grading/attendance
      // rosters until the underlying reason is fixed.
      toast.warning(
        classAutoAssigned
          ? 'Enrolled · section assigned, but roster sync was skipped'
          : 'Enrolled (Conditional) · section roster sync was skipped',
        {
          description:
            autoSync?.reason ??
            autoSync?.error ??
            'Check /records/unsynced to assign a section and complete the sync.',
        }
      );
      return null;
    } else if (body.openSteps && body.openSteps.length > 0) {
      // Enrolled anyway — say what is still outstanding and where it is
      // chased from, whatever happened with the class. The route sends
      // `openSteps` only on the change INTO Enrolled, so a re-save of an
      // already-Enrolled application never lands here.
      toast.success(
        classAutoAssigned
          ? 'Enrolled · class assigned · steps still open'
          : 'Enrolled · steps still open',
        {
          description: `Still to finish: ${body.openSteps.join(', ')}. They are listed under Admissions → Enrolled, steps still open.${
            body.awaitingPlacement
              ? ' They have no class yet — give them one on the Class Assignment card.'
              : ''
          }`,
        }
      );
      return null;
    } else if (classAutoAssigned) {
      return 'Enrolled · class assigned · added to the roster';
    } else if (body.awaitingPlacement === true) {
      // Step 10 done, step 11 still to come. Say so — otherwise this reads
      // identical to a fully-placed enrolment and nobody knows to follow up.
      toast.success('Enrolled · awaiting class assignment', {
        description:
          'They have no class yet — give them one on the Class Assignment card. Attendance starts on the day they are placed.',
      });
      return null;
    } else if (
      stageKey === 'application' &&
      autoSync?.change &&
      autoSync.change !== 'skipped' &&
      autoSync.change !== 'no-op'
    ) {
      // Conditional path where the sync DID land a section_students row.
      return 'Enrolled (Conditional) · synced to roster';
    }
    return changed === 0
      ? `${STAGE_LABELS[stageKey]} saved (no changes)`
      : `${STAGE_LABELS[stageKey]} updated`;
  }

  /**
   * The 422 + `blockers` shape covers two different server-side gates, each
   * needing a toast with a `description` this helper cannot build — so they
   * raise their own and return null.
   */
  function describeError(e: unknown): string | null {
    // 422 + `blockers` covers two different server-side gates. Discriminate
    // by stageKey:
    //   - documents → per-slot validation gate (P-Files hasn't marked all
    //     required slots as 'Valid'). Surface the slot list and offer a
    //     one-click hop to the student's P-Files profile.
    //   - application → Enrolled-prereq gate (one of the 5 prereq stages
    //     is incomplete).
    if (e instanceof ApiError && e.status === 422) {
      const body = (e.body ?? {}) as {
        blockers?: unknown;
        error?: string;
        code?: string;
      };
      // The student sits in a class the class read did not show (a
      // transferred student holds two rows). Mark the field required so the
      // registrar sees where the date goes, and keep the server's words.
      if (body.code === 'withdrawal_date_required') {
        setServerNeedsLastDay(true);
        return body.error ?? 'Enter the last day at school.';
      }
      if (Array.isArray(body.blockers) && body.blockers.length > 0) {
        if (stageKey === 'documents') {
          const docBlockers = body.blockers as Array<{
            slot: string;
            label: string;
            current: string | null;
            expected: string;
          }>;
          const lines = docBlockers.map(
            (b) => `${b.label} (${b.current ?? 'missing'})`
          );
          toast.error(
            `Documents not ready — ${docBlockers.length} slot${docBlockers.length === 1 ? '' : 's'} pending validation`,
            { description: lines.join(' · ') }
          );
          return null;
        }
        const enrolBlockers = body.blockers as Array<{
          stage: string;
          current: string | null;
          expected: string;
        }>;
        const lines = enrolBlockers.map(
          (b) =>
            `${b.stage}: ${b.current ?? 'not started'} → needs ${b.expected}`
        );
        toast.error(
          `Can't enroll yet — ${enrolBlockers.length} stage${enrolBlockers.length === 1 ? '' : 's'} still open`,
          {
            // Reached only when the page's copy of the steps was out of date
            // (the dialog otherwise asks for "Enrol anyway" before saving).
            description: `${lines.join(' · ')}. Refresh the page, then tick “Enrol anyway” to enrol with them open.`,
          }
        );
        return null;
      }
    }
    // Mirror the original `throw new Error(body.error ?? 'Failed to save')`
    // fallback string when the server body carries no `error` field.
    const serverError =
      e instanceof ApiError && e.body && typeof e.body === 'object'
        ? (e.body as { error?: string }).error
        : undefined;
    return serverError ?? 'Failed to save';
  }

  async function onSubmit(values: StageUpdateInput) {
    const extrasPayload = {
      ...values.extras,
      ...(stageKey === 'application' &&
        isTerminalStatus && {
          terminalReason: terminalReason || undefined,
          terminalNotes: terminalNotes.trim() || undefined,
        }),
    };
    // Awaited inside RHF's handleSubmit so `formState.isSubmitting` stays the
    // busy signal — and the await now spans the refresh too. `run` never
    // rejects, so the `.catch(() => {})` this used to need is gone.
    await run(
      () =>
        saveMutation.mutateAsync({
          ...values,
          extras: extrasPayload,
          // Only when the open steps were shown AND ticked — never by default.
          ...(enrolAnywayConfirmed ? { acknowledge_open_steps: true } : {}),
          // Sent whenever the application is being ended. Blank means "not
          // known" and is stored as blank — the server never fills it in.
          ...(endingApplication
            ? {
                withdrawal_date: lastDay || null,
                withdrawal_approved_date: approvedDate || null,
              }
            : {}),
        }),
      {
        pending: `Saving ${STAGE_LABELS[stageKey].toLowerCase()}…`,
        success: describeSuccess,
        error: describeError,
        // Swap this dialog's body to the late-enrollee prompt rather than
        // closing — never a second dialog stacked on the first.
        //
        // The refresh is unconditional now, which is the fix for this file's
        // Class B bug: the old code returned early on the mid-term branch and
        // relied on a second refresh landing later, leaving the page behind
        // the dialog showing the pre-write state. The roster row is written by
        // the request that just returned; the prompt only records WHICH term
        // the student joined, so there is nothing to wait for.
        onResolved: (body: StageResponse) => {
          const midTermPayload = body.midTermEnrolment;
          if (midTermPayload?.sectionId) {
            setPendingMidTerm(midTermPayload);
            return;
          }
          setOpen(false);
        },
      }
    );
  }

  const busy = form.formState.isSubmitting;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPendingMidTerm(null);
          // Reset to initials on close.
          setStatusChoice(
            initialStatus === null
              ? ''
              : initialIsCanonical
                ? initialStatus
                : OTHER_SENTINEL
          );
          setStatusOther(
            initialStatus !== null && !initialIsCanonical ? initialStatus : ''
          );
          setTerminalReason(
            (initialExtras?.terminalReason as
              | ApplicationTerminalReason
              | undefined) ?? ''
          );
          setTerminalNotes(
            (initialExtras?.terminalNotes as string | undefined) ?? ''
          );
          setLastDay('');
          setApprovedDate('');
          setServerNeedsLastDay(false);
          setEnrolAnyway(false);
          form.reset({
            status: initialStatus,
            remarks: initialRemarks,
            extras: cols.extras.reduce<ExtraValues>((acc, e) => {
              acc[e.fieldKey] = initialExtras[e.fieldKey] ?? null;
              return acc;
            }, {}),
          });
        }
      }}
    >
      {/* ⚠ NO `disabled` HERE ANY MORE. Until 2026-09-10 this button greyed
          itself out once the student was fully Enrolled (KD #147's freeze).
          That rule is gone: an enrolled student's funnel record stays
          correctable, and every save still writes an audit row. */}
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
          <Pencil className="size-3" />
          Edit
        </Button>
      </DialogTrigger>
      {/* ⚠ CAPPED AND SCROLLED, because this dialog has no fixed height. On the
          application stage it can carry the open-steps panel, the status
          select, a two-column details grid, a rich-text Remarks editor AND the
          terminal-reason block at once — taller than a laptop viewport, with
          Save pushed off the bottom and no way to reach it.
          `dvh` not `vh`: on mobile Safari the toolbar makes `vh` lie, which
          puts the footer under the browser chrome — the same bug the cap is
          here to fix. */}
      <DialogContent className="flex max-h-[85dvh] max-w-2xl! flex-col">
        {pendingMidTerm ? (
          // Scrolls on its own — it replaces the whole body, so it inherits the
          // cap but not the form's scroll container.
          <div className="min-h-0 flex-1 overflow-y-auto">
            <LateEnrolleePrompt
              payload={pendingMidTerm}
              // Just closes — the prompt awaits its own refresh now, so
              // refreshing here too would render the server twice for one save.
              onDone={() => {
                setPendingMidTerm(null);
                setOpen(false);
              }}
            />
          </div>
        ) : (
          <>
            <DialogHeader className="shrink-0">
              <DialogTitle className="font-serif text-lg font-semibold">
                Edit {STAGE_LABELS[stageKey]}
              </DialogTitle>
              <DialogDescription>
                Update the status, remarks, and any stage-specific fields.
              </DialogDescription>
            </DialogHeader>

            <Form {...form}>
              {/* The form is the flex column; only the fields between the
                  header and the footer scroll, so Save is always reachable —
                  which is the whole point of the cap above. */}
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="flex min-h-0 flex-1 flex-col"
              >
                {/* `pr-1` leaves room for the scrollbar so it does not sit on
                    top of the inputs' right edge. */}
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
                  {/* First in the form, so the open steps are read before the
                      status is saved. Amber: a caution the person can act
                      around, not a hard stop (§9.4). */}
                  {showOpenStepsWarning && (
                    <div className="space-y-3 rounded-lg border border-brand-amber/45 bg-brand-amber/10 p-3">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand-amber" />
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-foreground">
                            {openStepRows.length === 1
                              ? '1 step is still open'
                              : `${openStepRows.length} steps are still open`}
                          </p>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            You can enrol now to hold their place. They will be
                            listed under Admissions → Enrolled, steps still open
                            until every step is finished.
                          </p>
                        </div>
                      </div>
                      <ul className="space-y-1 pl-6.5">
                        {openStepRows.map((row) => (
                          <li
                            key={row.key}
                            className="flex flex-wrap items-baseline gap-x-2 text-xs"
                          >
                            <span className="font-medium text-foreground">
                              {STAGE_LABELS[row.key]}
                            </span>
                            <span className="text-muted-foreground">
                              {row.current ?? 'Not started'}, needs{' '}
                              {row.expected}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-brand-amber/45 bg-background px-3 py-2">
                        <Checkbox
                          checked={enrolAnyway}
                          onCheckedChange={(v) => setEnrolAnyway(v === true)}
                        />
                        <span className="text-sm font-medium text-foreground">
                          Enrol anyway, with these steps still open
                        </span>
                      </label>
                    </div>
                  )}

                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select
                      value={statusChoice}
                      onValueChange={setStatusChoice}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="No status" />
                      </SelectTrigger>
                      <SelectContent>
                        {canonicalOptions.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                        <SelectItem value={OTHER_SENTINEL}>Other…</SelectItem>
                      </SelectContent>
                    </Select>
                    {statusChoice === OTHER_SENTINEL && (
                      <Input
                        placeholder="Enter custom status"
                        value={statusOther}
                        onChange={(e) => setStatusOther(e.target.value)}
                        className="mt-2"
                        maxLength={120}
                      />
                    )}
                    {statusMissing ? (
                      <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                        <AlertTriangle className="size-3.5 shrink-0" />
                        {stageStatusMissingMessage(stageKey)}
                      </p>
                    ) : (
                      <FormDescription>
                        Pick from the canonical list or enter a custom value if
                        admissions still uses one not listed.
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>

                  {cols.extras.length > 0 && (
                    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Stage details
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {/* Plain fields first, then the score pairs, so Math
                            and English sit side by side on one row instead of
                            landing diagonally in the two-column grid. */}
                        {[
                          ...cols.extras.filter((x) => x.kind !== 'score'),
                          ...cols.extras.filter((x) => x.kind === 'score'),
                        ].map((e) =>
                          e.kind === 'score' ? (
                            <FormField
                              key={e.fieldKey}
                              control={form.control}
                              name={`extras.${e.fieldKey}` as const}
                              render={({ field }) => (
                                <FormItem>
                                  <AssessmentScoreField
                                    label={e.label}
                                    stored={initialExtras[e.fieldKey] ?? null}
                                    onChange={field.onChange}
                                    required={blockedFieldKeys.has(e.fieldKey)}
                                  />
                                </FormItem>
                              )}
                            />
                          ) : (
                            <FormField
                              key={e.fieldKey}
                              control={form.control}
                              name={`extras.${e.fieldKey}` as const}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">
                                    {e.label}
                                    {blockedFieldKeys.has(e.fieldKey) && (
                                      <span className="text-destructive">
                                        {' '}
                                        *
                                      </span>
                                    )}
                                  </FormLabel>
                                  <FormControl>
                                    {e.kind === 'date' ? (
                                      <DatePicker
                                        value={
                                          (field.value as string | null) ?? ''
                                        }
                                        onChange={(next) =>
                                          field.onChange(
                                            next === '' ? null : next
                                          )
                                        }
                                      />
                                    ) : (
                                      <Input
                                        type="text"
                                        value={
                                          (field.value as string | null) ?? ''
                                        }
                                        onChange={(ev) =>
                                          field.onChange(
                                            ev.target.value === ''
                                              ? null
                                              : ev.target.value
                                          )
                                        }
                                        placeholder=""
                                      />
                                    )}
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )
                        )}
                      </div>
                      {showCompletionNotice && (
                        <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                          <AlertTriangle className="size-3.5 shrink-0" />
                          {completionMessage}
                        </p>
                      )}
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="remarks"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Remarks</FormLabel>
                        <FormControl>
                          <RichTextEditor
                            value={field.value ?? ''}
                            onChange={(v) =>
                              field.onChange(v === '' ? null : v)
                            }
                            onBlur={field.onBlur}
                            rows={4}
                            placeholder="Notes for this stage…"
                            maxLength={4000}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {stageKey === 'application' && isTerminalStatus && (
                    <div className="space-y-4 rounded-lg border border-hairline p-4">
                      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Reason for ending the application
                      </p>

                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-foreground">
                          Category <span className="text-destructive">*</span>
                        </label>
                        <Select
                          value={terminalReason}
                          onValueChange={(v) =>
                            setTerminalReason(v as ApplicationTerminalReason)
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select a reason..." />
                          </SelectTrigger>
                          <SelectContent>
                            {APPLICATION_TERMINAL_REASON_VALUES.map((v) => (
                              <SelectItem key={v} value={v}>
                                {APPLICATION_TERMINAL_REASON_LABELS[v]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-foreground">
                          Notes
                          {terminalReason === 'other' && (
                            <span className="text-destructive"> *</span>
                          )}
                        </label>
                        <RichTextEditor
                          value={terminalNotes}
                          onChange={setTerminalNotes}
                          placeholder="Optional additional context..."
                          maxLength={200}
                          rows={2}
                        />
                      </div>

                      {/* The two dates the school keeps (migration 163) —
                          mirrors the withdrawal on the class roster. Shown
                          only when the student already sits in a class: an
                          applicant who never started has no last day, and
                          the dates are stored on the class row, so for an
                          applicant anything typed here went nowhere. */}
                      {lastDayOffered && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium text-foreground">
                              Last day at school
                              {lastDayRequired ? (
                                <span className="text-destructive"> *</span>
                              ) : (
                                <span className="font-normal text-muted-foreground">
                                  {' '}
                                  (optional)
                                </span>
                              )}
                            </label>
                            <DatePicker
                              value={lastDay}
                              onChange={setLastDay}
                              placeholder="Pick the last day"
                            />
                            <p className="text-[11px] leading-snug text-muted-foreground">
                              {neverAttended
                                ? 'No attendance has been recorded for them this year, so leave this empty unless the school holds a date.'
                                : 'The last day they actually attended.'}
                            </p>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium text-foreground">
                              Withdrawal approved
                            </label>
                            <DatePicker
                              value={approvedDate}
                              onChange={setApprovedDate}
                              placeholder="Pick a date"
                            />
                            <p className="text-[11px] leading-snug text-muted-foreground">
                              Can be after the last day, if the paperwork
                              followed later.
                            </p>
                          </div>
                        </div>
                      )}

                      {lastDayRequired && !lastDay && (
                        <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                          <AlertTriangle className="size-3.5 shrink-0" />
                          {alreadyPlaced && placedInClassNow
                            ? `They are in ${[alreadyPlaced.levelCode, alreadyPlaced.sectionName].filter(Boolean).join(' ')} — enter their last day at school.`
                            : 'They are in a class — enter their last day at school.'}
                        </p>
                      )}

                      {/* Says the quiet part: the status on this record and the
                          class they sit in disagree, which is why a form about
                          an application is asking about a classroom. Without
                          it the registrar is left to infer that the system is
                          confused, when it is the record that is behind. */}
                      {lastDayOffered && alreadyPlaced && placedInClassNow && (
                        <p className="text-[11px] leading-snug text-muted-foreground">
                          This application still reads{' '}
                          <span className="font-medium text-foreground">
                            {initialStatus ?? 'unset'}
                          </span>
                          , but they are already in{' '}
                          <span className="font-medium text-foreground">
                            {[
                              alreadyPlaced.levelCode,
                              alreadyPlaced.sectionName,
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          </span>
                          .{' '}
                          {effectiveStatus === 'Cancelled'
                            ? 'Cancelling'
                            : 'Withdrawing'}{' '}
                          takes them out of that class too.
                          {neverAttended
                            ? ' They have no attendance recorded this year.'
                            : ''}
                        </p>
                      )}

                      {!terminalReason ? (
                        <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                          <AlertTriangle className="size-3.5 shrink-0" />
                          Pick a reason before you can{' '}
                          {effectiveStatus === 'Cancelled'
                            ? 'cancel'
                            : 'withdraw'}{' '}
                          this application.
                        </p>
                      ) : (
                        terminalReason === 'other' &&
                        !terminalNotes.trim() && (
                          <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                            <AlertTriangle className="size-3.5 shrink-0" />
                            Add a note explaining the “Other” reason.
                          </p>
                        )
                      )}
                    </div>
                  )}
                </div>

                <DialogFooter className="shrink-0 gap-2 border-t border-border pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setOpen(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    loading={busy}
                    loadingText="Saving…"
                    disabled={
                      statusMissing ||
                      completionBlockers.length > 0 ||
                      !scoreCheck.ok ||
                      (showOpenStepsWarning && !enrolAnyway) ||
                      (lastDayRequired && !lastDay) ||
                      (stageKey === 'application' &&
                        isTerminalStatus &&
                        (!terminalReason ||
                          (terminalReason === 'other' &&
                            !terminalNotes.trim())))
                    }
                  >
                    Save changes
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
