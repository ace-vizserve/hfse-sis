'use client';

import { useMutation } from '@tanstack/react-query';
import { Info, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  ADMISSION_SCHEDULES,
  ADMISSION_TRACKS,
  STAFF_SCHEDULE_LABEL,
  describeNameReach,
  optionDisplayName,
  type NameReach,
  trackForClassType,
  type AdmissionSchedule,
  type AdmissionTrack,
} from '@/lib/admissions/options';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// The add / edit drawer on /sis/admin/admission-options (09a §8 "Sheet for
// secondary forms"). One component for both, because an edit is the same four
// facts as an add — the level name parents see, the SIS level it counts as,
// the class type parents see, and its track — minus the sessions, which the
// row's own switches own once it exists.
//
// A rename of the level name shows the accent status panel (09a §9.4): the
// enrolment portal's re-enrolment progression and fee lists key on that TEXT,
// and nothing here can update them.

export type SheetLevel = { id: string; code: string; label: string };

export type AdmissionOptionEditTarget = {
  levelLabel: string;
  classTypeLabel: string;
  levelId: string;
  track: AdmissionTrack;
  /**
   * How many options use this level name, across every year. A "Counts as"
   * change on an unchanged name moves ALL of them (the name's meaning is
   * global), so the drawer says so before saving.
   */
  nameReach?: NameReach;
};

type FormState = {
  levelLabel: string;
  levelId: string;
  classTypeLabel: string;
  track: AdmissionTrack;
  /** Whether the track was picked by hand — until then it follows the class type. */
  trackTouched: boolean;
  schedules: AdmissionSchedule[];
};

function initialState(target: AdmissionOptionEditTarget | null): FormState {
  return target
    ? {
        levelLabel: target.levelLabel,
        levelId: target.levelId,
        classTypeLabel: target.classTypeLabel,
        track: target.track,
        trackTouched: true,
        schedules: [],
      }
    : {
        levelLabel: '',
        levelId: '',
        classTypeLabel: '',
        track: 'Standard',
        trackTouched: false,
        schedules: ['morning', 'afternoon'],
      };
}

function AdmissionOptionSheet({
  open,
  onOpenChange,
  ayCode,
  levels,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ayCode: string;
  levels: readonly SheetLevel[];
  /** null = add a new option; otherwise the combination being edited. */
  target: AdmissionOptionEditTarget | null;
}) {
  // State starts from `target` on mount. The callers remount this component
  // (a fresh `key`) each time the drawer opens, so a cancelled edit never
  // leaks into the next one.
  const isEdit = target !== null;
  const [form, setForm] = useState<FormState>(() => initialState(target));
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const run = useWriteAction();

  const mutation = useMutation({
    mutationFn: (state: FormState) =>
      target !== null
        ? apiFetch(
            '/api/sis/admission-options/group',
            jsonInit('PATCH', {
              ayCode,
              fromLevelLabel: target.levelLabel,
              fromClassTypeLabel: target.classTypeLabel,
              levelLabel: state.levelLabel.trim(),
              levelId: state.levelId,
              classTypeLabel: state.classTypeLabel.trim(),
              track: state.track,
            })
          )
        : apiFetch(
            '/api/sis/admission-options',
            jsonInit('POST', {
              ayCode,
              levelLabel: state.levelLabel.trim(),
              levelId: state.levelId,
              classTypeLabel: state.classTypeLabel.trim(),
              track: state.track,
              schedules: state.schedules,
            })
          ),
  });

  const errors = {
    levelLabel: form.levelLabel.trim()
      ? null
      : 'Enter the level name parents see.',
    levelId: form.levelId ? null : 'Choose the level this counts as.',
    classTypeLabel: form.classTypeLabel.trim()
      ? null
      : 'Enter the class type parents see.',
    schedules:
      isEdit || form.schedules.length > 0
        ? null
        : 'Choose at least one session.',
  };
  const valid = Object.values(errors).every((e) => e === null);
  const renamed =
    target !== null && form.levelLabel.trim() !== target.levelLabel;
  // Same name, new "Counts as": the change reaches every option with the name.
  const recounted =
    target !== null &&
    !renamed &&
    !!form.levelId &&
    form.levelId !== target.levelId;
  const recountText =
    recounted && target !== null
      ? describeNameReach(
          target.nameReach ?? { options: 1, ayCodes: [ayCode] },
          levels.find((l) => l.id === form.levelId)?.label ?? 'the new level'
        )
      : null;
  const name = optionDisplayName(
    form.levelLabel.trim(),
    form.classTypeLabel.trim()
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    await run(() => mutation.mutateAsync(form), {
      pending: isEdit ? `Saving ${name}…` : `Adding ${name}…`,
      success: isEdit
        ? `Saved ${name}`
        : `Added ${name} to the ${ayCode} forms`,
      onResolved: () => onOpenChange(false),
    });
    setSaving(false);
  }

  const err = (msg: string | null) =>
    showErrors && msg ? <FieldError>{msg}</FieldError> : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-lg"
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="gap-1.5 border-b border-border p-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Enrolment forms · {ayCode}
            </p>
            <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
              {isEdit ? 'Edit option' : 'Add an option'}
            </SheetTitle>
            <SheetDescription>
              {isEdit
                ? 'Changes every session of this option. Open and close sessions with the switches on the page.'
                : 'Parents will be able to pick this on the enrolment forms as soon as it is saved.'}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <FieldGroup>
              <Field data-invalid={showErrors && !!errors.levelLabel}>
                <FieldLabel htmlFor="ao-level-label">
                  Level name parents see
                </FieldLabel>
                <Input
                  id="ao-level-label"
                  autoFocus
                  value={form.levelLabel}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, levelLabel: e.target.value }))
                  }
                  placeholder="Primary Three"
                />
                <FieldDescription>
                  Exactly as it appears in the level list on the forms.
                </FieldDescription>
                {err(errors.levelLabel)}
              </Field>

              {renamed && (
                <div className="flex items-start gap-3 rounded-xl border border-brand-indigo-soft bg-accent p-4">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                    <Info className="size-4" />
                  </div>
                  <p className="text-sm text-brand-indigo-deep">
                    The enrolment portal also uses this name for re-enrolment
                    and fees. Renaming it here won&apos;t update those.
                  </p>
                </div>
              )}

              <Field data-invalid={showErrors && !!errors.levelId}>
                <FieldLabel htmlFor="ao-level-id">Counts as</FieldLabel>
                <Select
                  value={form.levelId}
                  onValueChange={(v) => setForm((f) => ({ ...f, levelId: v }))}
                >
                  <SelectTrigger id="ao-level-id" className="w-full">
                    <SelectValue placeholder="Choose a level" />
                  </SelectTrigger>
                  <SelectContent>
                    {levels.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  The level a child who picks this is placed in.
                </FieldDescription>
                {err(errors.levelId)}
              </Field>

              {recountText && (
                <div className="flex items-start gap-3 rounded-xl border border-brand-indigo-soft bg-accent p-4">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                    <Info className="size-4" />
                  </div>
                  <p className="text-sm text-brand-indigo-deep">
                    {recountText}
                  </p>
                </div>
              )}

              <Field data-invalid={showErrors && !!errors.classTypeLabel}>
                <FieldLabel htmlFor="ao-class-type">
                  Class type parents see
                </FieldLabel>
                <Input
                  id="ao-class-type"
                  value={form.classTypeLabel}
                  onChange={(e) => {
                    const classTypeLabel = e.target.value;
                    setForm((f) => ({
                      ...f,
                      classTypeLabel,
                      track: f.trackTouched
                        ? f.track
                        : trackForClassType(classTypeLabel),
                    }));
                  }}
                  placeholder="Standard Class"
                />
                {err(errors.classTypeLabel)}
              </Field>

              <FieldSet className="gap-3">
                <FieldLegend variant="label" className="mb-0">
                  Track
                </FieldLegend>
                <FieldDescription>
                  Which kind of class this places the child in.
                </FieldDescription>
                <RadioGroup
                  value={form.track}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      track: v as AdmissionTrack,
                      trackTouched: true,
                    }))
                  }
                  className="grid grid-cols-2 gap-3"
                >
                  {ADMISSION_TRACKS.map((t) => (
                    <label
                      key={t}
                      className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm font-medium text-foreground has-[[data-state=checked]]:border-brand-indigo has-[[data-state=checked]]:bg-brand-indigo/5"
                    >
                      <RadioGroupItem value={t} />
                      {t}
                    </label>
                  ))}
                </RadioGroup>
              </FieldSet>

              {!isEdit && (
                <FieldSet
                  className="gap-3"
                  data-invalid={showErrors && !!errors.schedules}
                >
                  <FieldLegend variant="label" className="mb-0">
                    Sessions
                  </FieldLegend>
                  <FieldDescription>
                    Each one gets its own switch on the page.
                  </FieldDescription>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {ADMISSION_SCHEDULES.map((s) => {
                      const checked = form.schedules.includes(s);
                      return (
                        <label
                          key={s}
                          className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm font-medium text-foreground has-[[data-state=checked]]:border-brand-indigo has-[[data-state=checked]]:bg-brand-indigo/5"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) =>
                              setForm((f) => ({
                                ...f,
                                schedules: v
                                  ? ADMISSION_SCHEDULES.filter(
                                      (x) => x === s || f.schedules.includes(x)
                                    )
                                  : f.schedules.filter((x) => x !== s),
                              }))
                            }
                          />
                          {STAFF_SCHEDULE_LABEL[s]}
                        </label>
                      );
                    })}
                  </div>
                  {err(errors.schedules)}
                </FieldSet>
              )}
            </FieldGroup>
          </div>

          <SheetFooter className="gap-2 border-t border-border p-5">
            <SheetClose asChild>
              <Button type="button" variant="outline" disabled={saving}>
                Cancel
              </Button>
            </SheetClose>
            <Button
              type="submit"
              loading={saving}
              loadingText={isEdit ? 'Saving…' : 'Adding…'}
            >
              {isEdit ? 'Save changes' : 'Add option'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** The header's primary CTA — or an outline one beside "Copy from …" on an empty year. */
export function AddAdmissionOptionButton({
  ayCode,
  levels,
  variant = 'default',
}: {
  ayCode: string;
  levels: readonly SheetLevel[];
  variant?: 'default' | 'outline';
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        variant={variant}
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
      >
        <Plus className="size-4" />
        Add option
      </Button>
      <AdmissionOptionSheet
        key={session}
        open={open}
        onOpenChange={setOpen}
        ayCode={ayCode}
        levels={levels}
        target={null}
      />
    </>
  );
}

/**
 * The row's overflow menu. The Sheet is a sibling of the menu, opened from the
 * item's `onSelect` — never nested inside the menu, which would unmount it the
 * moment the menu closes.
 */
export function AdmissionOptionRowMenu({
  ayCode,
  levels,
  target,
}: {
  ayCode: string;
  levels: readonly SheetLevel[];
  target: AdmissionOptionEditTarget;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`More for ${optionDisplayName(target.levelLabel, target.classTypeLabel)}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setSession((n) => n + 1);
              setOpen(true);
            }}
          >
            <Pencil className="size-3.5" />
            Edit
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AdmissionOptionSheet
        key={session}
        open={open}
        onOpenChange={setOpen}
        ayCode={ayCode}
        levels={levels}
        target={target}
      />
    </>
  );
}
