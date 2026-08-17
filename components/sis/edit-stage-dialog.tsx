'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import { MAX_ACTIVE_PER_SECTION } from '@/lib/sis/class-assignment';
import { LateEnrolleePrompt } from '@/components/sis/late-enrollee-prompt';
import type { MidTermPayload } from '@/lib/sis/placement-completion';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
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
  frozen = false,
  canAssignSection = false,
}: {
  ayCode: string;
  enroleeNumber: string;
  stageKey: StageKey;
  initialStatus: string | null;
  initialRemarks: string | null;
  initialExtras: ExtraValues;
  /**
   * When true the student is fully Enrolled — the admissions funnel becomes a
   * read-only record (KD #147). The trigger button is disabled and submit is
   * guarded. Enrolment changes move to Records, documents to P-Files.
   */
  frozen?: boolean;
  /**
   * Current statuses for the 5 ENROLLED_PREREQ_STAGES. Optional — when
   * provided AND `stageKey === 'application'` AND the user picks `Enrolled`
   * (or `Enrolled (Conditional)`), the dialog renders an advisory checklist
   * above the status select so admin sees BEFORE submit which prereqs are
   * incomplete. The server still re-validates and 422s on miss; this is
   * purely a heads-up.
   */
  prereqStatuses?: Partial<Record<StageKey, string | null>>;
  /**
   * May this viewer put a student in a class? Class Assignment is step 11 of
   * HFSE's admission process and belongs to Records, so an admissions user
   * finishing step 10 never sees the picker — and the server 403s them if
   * they somehow post one. Defaults to false: a caller that forgets to pass
   * it renders no picker, rather than one whose save is refused.
   */
  canAssignSection?: boolean;
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
    ? ENROLLED_PREREQ_STAGES.map((k) => {
        const current = prereqStatuses?.[k] ?? null;
        const expected = STAGE_TERMINAL_STATUS[k] ?? '';
        return { key: k, current, expected, ok: current === expected };
      })
    : [];
  const incompleteCount = prereqRows.filter((r) => !r.ok).length;

  // Optional inline section picker (not a nested dialog), shown once the
  // registrar's pending choice is "Enrolled" AND they're allowed to place
  // students.
  //
  // OPTIONAL is the point: HFSE enrols at step 10 and assigns the class at
  // step 11, so leaving this empty is the normal path, not an incomplete
  // form. Submit is never gated on it. The picker exists only as a shortcut
  // for a coordinator doing both jobs in one sitting; the stage PATCH route
  // is the real enforcement and 422s (prereqs) or 403s (placement role) on a
  // miss, which `saveMutation.onError` surfaces as a toast.
  // ALL FIVE PREREQUISITES MUST ACTUALLY BE MET, and we must know that they
  // are. `incompleteCount === 0` alone is not enough: `prereqRows` is also
  // empty when the checklist is not showing at all — including when
  // `prereqStatuses` was never supplied — so a bare count check reads "we have
  // no idea" as "all clear". Requiring `showPrereqChecklist` too means the
  // picker appears only when the prerequisites are known AND met, and stays
  // hidden when they are unknown. Hiding is the safe direction: the stage
  // PATCH route 422s on a miss regardless, so the only thing an ungated picker
  // buys is a registrar filling in a class for a student who cannot be
  // enrolled, then losing the lot to a failed save.
  const prereqsAllMet = showPrereqChecklist && incompleteCount === 0;

  const canPickSectionNow =
    stageKey === 'application' &&
    effectiveStatus === 'Enrolled' &&
    canAssignSection &&
    prereqsAllMet;

  const [sectionId, setSectionId] = useState<string | null>(null);

  const sectionsQuery = useQuery({
    queryKey: ['assignable-sections', enroleeNumber, ayCode],
    queryFn: () =>
      apiFetch<{
        level: {
          id: string;
          code: string;
          label: string;
          levelType: 'primary' | 'secondary';
        } | null;
        sections: { id: string; name: string; activeCount: number }[];
      }>(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/assignable-sections?ay=${encodeURIComponent(ayCode)}`
      ),
    enabled: canPickSectionNow,
  });

  useEffect(() => {
    if (!canPickSectionNow) setSectionId(null);
  }, [canPickSectionNow]);

  const isTerminalStatus = (
    APPLICATION_TERMINAL_STATUSES as readonly string[]
  ).includes(effectiveStatus ?? '');
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
    }
  }, [isTerminalStatus]);

  type StageResponse = {
    changed?: number;
    classAutoAssigned?: boolean;
    awaitingPlacement?: boolean;
    autoSync?: { change?: string; reason?: string; error?: string };
    autoSyncFailed?: boolean;
    withdrawalCascade?: {
      rowsAffected: number;
      sectionStudentIds: string[];
    } | null;
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
    } else if (classAutoAssigned) {
      return 'Enrolled · class assigned · added to the roster';
    } else if (body.awaitingPlacement === true) {
      // Step 10 done, step 11 still to come. Say so — otherwise this reads
      // identical to a fully-placed enrolment and nobody knows to follow up.
      toast.success('Enrolled · awaiting class assignment', {
        description:
          'They are now under Records → Students needing setup. Attendance starts on the day they are placed.',
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
      };
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
          { description: lines.join(' · ') }
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
    if (frozen) return;
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
          ...(canPickSectionNow && sectionId ? { section_id: sectionId } : {}),
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
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={frozen}
          title={
            frozen
              ? 'Enrolled — managed in Records (enrolment) and P-Files (documents).'
              : undefined
          }
        >
          <Pencil className="size-3" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        {pendingMidTerm ? (
          <LateEnrolleePrompt
            payload={pendingMidTerm}
            // Just closes — the prompt awaits its own refresh now, so
            // refreshing here too would render the server twice for one save.
            onDone={() => {
              setPendingMidTerm(null);
              setOpen(false);
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-serif text-lg font-semibold">
                Edit {STAGE_LABELS[stageKey]}
              </DialogTitle>
              <DialogDescription>
                Update the status, remarks, and any stage-specific fields.
              </DialogDescription>
            </DialogHeader>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-5"
              >
                {canPickSectionNow && (
                  <div className="space-y-2.5 rounded-md border border-hairline bg-muted/30 p-3">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Assign a class now (optional)
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Leave this empty to enrol now — the student will appear
                      under Records → Students needing setup, waiting for a
                      class. Attendance starts on the day they are placed.
                    </p>
                    {sectionsQuery.isLoading ? (
                      <p className="text-xs text-muted-foreground">
                        Loading classes…
                      </p>
                    ) : sectionsQuery.isError ? (
                      <p className="text-xs text-destructive">
                        {sectionsQuery.error instanceof ApiError
                          ? sectionsQuery.error.message
                          : "Couldn't load classes — try again."}
                      </p>
                    ) : !sectionsQuery.data?.level ? (
                      <p className="text-xs text-muted-foreground">
                        This applicant&apos;s level name isn&apos;t recognised
                        yet, so no classes can be listed. You can still enrol
                        them — resolve the name under Records → Levels needing
                        attention, then assign a class.
                      </p>
                    ) : sectionsQuery.data.sections.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        There are no classes at {sectionsQuery.data.level.label}{' '}
                        yet. You can still enrol this student — create a class
                        under SIS Admin → Section setup, then assign it from
                        Records.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {[...sectionsQuery.data.sections]
                          .sort((a, b) => a.activeCount - b.activeCount)
                          .map((sec) => {
                            const full =
                              sec.activeCount >= MAX_ACTIVE_PER_SECTION;
                            return (
                              <button
                                key={sec.id}
                                type="button"
                                disabled={full}
                                onClick={() => setSectionId(sec.id)}
                                aria-pressed={sectionId === sec.id}
                                className={
                                  'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ' +
                                  (sectionId === sec.id
                                    ? 'border-brand-indigo bg-accent'
                                    : full
                                      ? 'cursor-not-allowed border-border/60 bg-muted/30 opacity-60'
                                      : 'border-border hover:bg-accent/40')
                                }
                              >
                                <span className="font-medium text-foreground">
                                  {sec.name}
                                </span>
                                <span className="font-mono tabular-nums text-muted-foreground">
                                  {sec.activeCount}/{MAX_ACTIVE_PER_SECTION}
                                  {full ? ' · Full' : ''}
                                </span>
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                )}

                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select value={statusChoice} onValueChange={setStatusChoice}>
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
                  <FormDescription>
                    Pick from the canonical list or enter a custom value if
                    admissions still uses one not listed.
                  </FormDescription>
                  <FormMessage />
                </FormItem>

                {cols.extras.length > 0 && (
                  <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Stage details
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {cols.extras.map((e) => (
                        <FormField
                          key={e.fieldKey}
                          control={form.control}
                          name={`extras.${e.fieldKey}` as const}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">
                                {e.label}
                              </FormLabel>
                              <FormControl>
                                {e.kind === 'date' ? (
                                  <DatePicker
                                    value={(field.value as string | null) ?? ''}
                                    onChange={(next) =>
                                      field.onChange(next === '' ? null : next)
                                    }
                                  />
                                ) : (
                                  <Input
                                    type="text"
                                    value={(field.value as string | null) ?? ''}
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
                      ))}
                    </div>
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="remarks"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Remarks</FormLabel>
                      <FormControl>
                        <Textarea
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === '' ? null : e.target.value
                            )
                          }
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
                      <Textarea
                        value={terminalNotes}
                        onChange={(e) => setTerminalNotes(e.target.value)}
                        placeholder="Optional additional context..."
                        maxLength={200}
                        rows={2}
                      />
                    </div>

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

                <DialogFooter className="gap-2">
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
                      stageKey === 'application' &&
                      isTerminalStatus &&
                      (!terminalReason ||
                        (terminalReason === 'other' && !terminalNotes.trim()))
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
