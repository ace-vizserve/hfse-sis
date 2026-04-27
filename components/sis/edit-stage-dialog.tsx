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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  ENROLLED_PREREQ_STAGES,
  STAGE_COLUMN_MAP,
  STAGE_LABELS,
  STAGE_STATUS_OPTIONS,
  STAGE_TERMINAL_STATUS,
  StageUpdateSchema,
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

  const cols = STAGE_COLUMN_MAP[stageKey];
  const canonicalOptions = STAGE_STATUS_OPTIONS[stageKey];

  // Two state pieces: the dropdown choice (canonical OR sentinel) and the
  // free-text override when the user picks "Other". This avoids round-tripping
  // through the form's `status` field on every keystroke.
  const initialIsCanonical =
    initialStatus !== null && (canonicalOptions as readonly string[]).includes(initialStatus);
  const [statusChoice, setStatusChoice] = useState<string>(
    initialStatus === null ? '' : initialIsCanonical ? initialStatus : OTHER_SENTINEL,
  );
  const [statusOther, setStatusOther] = useState<string>(
    initialStatus !== null && !initialIsCanonical ? initialStatus : '',
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
      form.setValue('status', statusOther.trim() ? statusOther : null, { shouldDirty: true });
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
    (effectiveStatus === 'Enrolled' || effectiveStatus === 'Enrolled (Conditional)');
  const prereqRows = showPrereqChecklist
    ? ENROLLED_PREREQ_STAGES.map((k) => {
        const current = prereqStatuses?.[k] ?? null;
        const expected = STAGE_TERMINAL_STATUS[k] ?? '';
        return { key: k, current, expected, ok: current === expected };
      })
    : [];
  const incompleteCount = prereqRows.filter((r) => !r.ok).length;

  async function onSubmit(values: StageUpdateInput) {
    try {
      const res = await fetch(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/stage/${stageKey}?ay=${encodeURIComponent(ayCode)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(values),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 422 with a `blockers` array = Enrolled-prereq gate. Surface the
        // human-readable list so admissions knows which stages to finish
        // before flipping to Enrolled.
        const blockers = body.blockers as
          | Array<{ stage: string; current: string | null; expected: string }>
          | undefined;
        if (res.status === 422 && Array.isArray(blockers) && blockers.length > 0) {
          const lines = blockers.map(
            (b) => `${b.stage}: ${b.current ?? 'not started'} → needs ${b.expected}`,
          );
          toast.error(`Can't enroll yet — ${blockers.length} stage${blockers.length === 1 ? '' : 's'} still open`, {
            description: lines.join(' · '),
          });
          return;
        }
        throw new Error(body.error ?? 'Failed to save');
      }
      const changed = body.changed as number | undefined;
      const classAutoAssigned = body.classAutoAssigned === true;
      const autoSyncChange = body.autoSync?.change as string | undefined;
      toast.success(
        classAutoAssigned
          ? `Enrolled · class auto-assigned${autoSyncChange && autoSyncChange !== 'skipped' ? ` · synced to roster` : ''}`
          : changed === 0
            ? `${STAGE_LABELS[stageKey]} saved (no changes)`
            : `${STAGE_LABELS[stageKey]} updated`,
      );
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
          // Reset to initials on close.
          setStatusChoice(initialStatus === null ? '' : initialIsCanonical ? initialStatus : OTHER_SENTINEL);
          setStatusOther(initialStatus !== null && !initialIsCanonical ? initialStatus : '');
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
        <DialogHeader>
          <DialogTitle className="font-serif text-lg font-semibold">
            Edit {STAGE_LABELS[stageKey]}
          </DialogTitle>
          <DialogDescription>
            Update the status, remarks, and any stage-specific fields. Audit-logged on save.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {showPrereqChecklist && (
              <div className="space-y-2.5 rounded-md border border-hairline bg-muted/30 p-3">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Prerequisites for Enrolled
                </p>
                <ul className="space-y-1.5">
                  {prereqRows.map((row) => (
                    <li key={row.key} className="flex items-center gap-2 text-xs">
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
                    All prerequisites met
                  </p>
                ) : (
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-destructive">
                    {incompleteCount} prerequisite{incompleteCount === 1 ? '' : 's'} incomplete
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
                Pick from the canonical list or enter a custom value if admissions still uses one not listed.
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
                          <FormLabel className="text-xs">{e.label}</FormLabel>
                          <FormControl>
                            {e.kind === 'date' ? (
                              <DatePicker
                                value={(field.value as string | null) ?? ''}
                                onChange={(next) => field.onChange(next === '' ? null : next)}
                              />
                            ) : (
                              <Input
                                type="text"
                                value={(field.value as string | null) ?? ''}
                                onChange={(ev) =>
                                  field.onChange(ev.target.value === '' ? null : ev.target.value)
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
                      onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                      rows={4}
                      placeholder="Notes for this stage…"
                      maxLength={4000}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
