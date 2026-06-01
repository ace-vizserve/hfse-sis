'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, CheckCircle2, Loader2, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

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
type MidTermPayload = {
  termNumber: number; // active term
  termLabel: string;
  sectionId: string;
  sectionStudentId: string;
  nextTermNumber: number | null;
  canDeferToNext: boolean;
  daysLeftInActiveTerm: number | null;
};

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
   * provided AND `stageKey === 'application'` AND the user picks `Enrolled`
   * (or `Enrolled (Conditional)`), the dialog renders an advisory checklist
   * above the status select so admin sees BEFORE submit which prereqs are
   * incomplete. The server still re-validates and 422s on miss; this is
   * purely a heads-up.
   */
  prereqStatuses?: Partial<Record<StageKey, string | null>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingMidTerm, setPendingMidTerm] = useState<MidTermPayload | null>(
    null
  );
  // The registrar-chosen joining term (active term = "join current",
  // next term = "start next"). Defaults to the active term when the prompt opens.
  const [chosenTerm, setChosenTerm] = useState<number | null>(null);
  const [applyingLate, setApplyingLate] = useState(false);

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

  async function onSubmit(values: StageUpdateInput) {
    try {
      const extrasPayload = {
        ...values.extras,
        ...(stageKey === 'application' &&
          isTerminalStatus && {
            terminalReason: terminalReason || undefined,
            terminalNotes: terminalNotes.trim() || undefined,
          }),
      };
      const res = await fetch(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/stage/${stageKey}?ay=${encodeURIComponent(ayCode)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...values, extras: extrasPayload }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 422 + `blockers` covers two different server-side gates. Discriminate
        // by stageKey:
        //   - documents → per-slot validation gate (P-Files hasn't marked all
        //     required slots as 'Valid'). Surface the slot list and offer a
        //     one-click hop to the student's P-Files profile.
        //   - application → Enrolled-prereq gate (one of the 5 prereq stages
        //     is incomplete).
        if (
          res.status === 422 &&
          Array.isArray(body.blockers) &&
          body.blockers.length > 0
        ) {
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
            return;
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
          return;
        }
        throw new Error(body.error ?? 'Failed to save');
      }
      const changed = body.changed as number | undefined;
      const classAutoAssigned = body.classAutoAssigned === true;
      const autoSync = body.autoSync as
        | { change?: string; reason?: string; error?: string }
        | undefined;
      const autoSyncFailed = body.autoSyncFailed === true;
      const withdrawalCascade = body.withdrawalCascade as
        | { rowsAffected: number; sectionStudentIds: string[] }
        | null
        | undefined;

      // Withdrawn / Cancelled cascade outcome takes priority on the toast.
      // The cascade only fires when the flip actually changed section rows;
      // null means "no active section to withdraw from" (acceptable no-op).
      if (withdrawalCascade && withdrawalCascade.rowsAffected > 0) {
        toast.success(
          `${STAGE_LABELS[stageKey]} updated · ${withdrawalCascade.rowsAffected} section row${
            withdrawalCascade.rowsAffected === 1 ? '' : 's'
          } flipped to withdrawn`
        );
      } else if (autoSyncFailed) {
        // Either Enrolled (class auto-assigned then sync skipped) OR
        // Enrolled (Conditional) with classSection already set but sync
        // failed for a non-empty reason. Either way the student appears
        // Enrolled in admissions but is missing from grading/attendance
        // rosters until the underlying reason is fixed.
        toast.warning(
          classAutoAssigned
            ? 'Enrolled · class auto-assigned, but section roster sync was skipped'
            : 'Enrolled (Conditional) · section roster sync was skipped',
          {
            description:
              autoSync?.reason ??
              autoSync?.error ??
              'Check /records/unsynced to assign a section and complete the sync.',
          }
        );
      } else if (classAutoAssigned) {
        toast.success('Enrolled · class auto-assigned · synced to roster');
      } else if (
        stageKey === 'application' &&
        autoSync?.change &&
        autoSync.change !== 'skipped' &&
        autoSync.change !== 'no-op'
      ) {
        // Conditional path where the sync DID land a section_students row.
        toast.success('Enrolled (Conditional) · synced to roster');
      } else {
        toast.success(
          changed === 0
            ? `${STAGE_LABELS[stageKey]} saved (no changes)`
            : `${STAGE_LABELS[stageKey]} updated`
        );
      }
      const midTermPayload = body.midTermEnrolment as
        | MidTermPayload
        | null
        | undefined;
      if (midTermPayload?.sectionId) {
        setPendingMidTerm(midTermPayload);
        setChosenTerm(midTermPayload.termNumber); // default = active term
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    }
  }

  const busy = form.formState.isSubmitting;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPendingMidTerm(null);
          setChosenTerm(null);
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
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
          <Pencil className="size-3" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        {pendingMidTerm ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-serif text-lg font-semibold">
                Enrolling mid-year
              </DialogTitle>
              <DialogDescription>
                Enrolled after {pendingMidTerm.termLabel} started — this is a
                late enrollee. Choose how they join (this skips assessments from
                before they joined).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => setChosenTerm(pendingMidTerm.termNumber)}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                  chosenTerm === pendingMidTerm.termNumber
                    ? 'border-primary bg-accent text-foreground'
                    : 'border-hairline text-foreground hover:bg-muted/50'
                }`}
              >
                Join {pendingMidTerm.termLabel} now
                {pendingMidTerm.daysLeftInActiveTerm !== null &&
                  pendingMidTerm.daysLeftInActiveTerm < 14 && (
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-brand-amber">
                      ends in {pendingMidTerm.daysLeftInActiveTerm}d
                    </span>
                  )}
              </button>
              {pendingMidTerm.canDeferToNext &&
                pendingMidTerm.nextTermNumber !== null && (
                  <button
                    type="button"
                    onClick={() =>
                      setChosenTerm(pendingMidTerm.nextTermNumber!)
                    }
                    className={`flex w-full items-center rounded-lg border px-3 py-2 text-left text-sm ${
                      chosenTerm === pendingMidTerm.nextTermNumber
                        ? 'border-primary bg-accent text-foreground'
                        : 'border-hairline text-foreground hover:bg-muted/50'
                    }`}
                  >
                    Start in T{pendingMidTerm.nextTermNumber} instead
                  </button>
                )}
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={applyingLate}
                onClick={() => {
                  setPendingMidTerm(null);
                  setChosenTerm(null);
                  setOpen(false);
                  router.refresh();
                }}
              >
                Not a late enrollee
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={applyingLate || chosenTerm === null}
                onClick={async () => {
                  if (chosenTerm === null) return;
                  setApplyingLate(true);
                  try {
                    const res = await fetch(
                      `/api/sections/${pendingMidTerm.sectionId}/students/${pendingMidTerm.sectionStudentId}`,
                      {
                        method: 'PATCH',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          enrollment_status: 'late_enrollee',
                          late_enrollee_term_number: chosenTerm,
                        }),
                      }
                    );
                    if (!res.ok)
                      throw new Error('Failed to mark as late enrollee');
                    toast.success(`Marked as late enrollee · T${chosenTerm}`);
                  } catch (e) {
                    toast.error(
                      e instanceof Error
                        ? e.message
                        : 'Could not mark as late enrollee'
                    );
                  } finally {
                    setApplyingLate(false);
                    setPendingMidTerm(null);
                    setChosenTerm(null);
                    setOpen(false);
                    router.refresh();
                  }
                }}
              >
                {applyingLate && <Loader2 className="size-3.5 animate-spin" />}
                {applyingLate ? 'Saving…' : 'Confirm'}
              </Button>
            </DialogFooter>
          </>
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
                {showPrereqChecklist && (
                  <div className="space-y-2.5 rounded-md border border-hairline bg-muted/30 p-3">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Required steps before enrolment
                    </p>
                    <ul className="space-y-1.5">
                      {prereqRows.map((row) => (
                        <li
                          key={row.key}
                          className="flex items-center gap-2 text-xs"
                        >
                          {row.ok ? (
                            <CheckCircle2 className="size-3.5 shrink-0 text-brand-mint" />
                          ) : (
                            <AlertTriangle className="size-3.5 shrink-0 text-brand-amber" />
                          )}
                          <span className="font-medium text-foreground">
                            {STAGE_LABELS[row.key]}
                          </span>
                          <span className="text-muted-foreground">·</span>
                          <span
                            className={
                              row.ok
                                ? 'text-muted-foreground'
                                : 'text-foreground'
                            }
                          >
                            {row.current ?? 'not started'}
                          </span>
                          {!row.ok && (
                            <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                              → needs {row.expected}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {incompleteCount === 0 ? (
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-mint">
                        All requirements met
                      </p>
                    ) : (
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-destructive">
                        {incompleteCount} requirement
                        {incompleteCount === 1 ? '' : 's'} not met yet
                        {' · '}saving will fail
                      </p>
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
                    disabled={
                      busy ||
                      (stageKey === 'application' &&
                        isTerminalStatus &&
                        (!terminalReason ||
                          (terminalReason === 'other' &&
                            !terminalNotes.trim())))
                    }
                  >
                    {busy && <Loader2 className="size-3.5 animate-spin" />}
                    {busy ? 'Saving…' : 'Save changes'}
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
