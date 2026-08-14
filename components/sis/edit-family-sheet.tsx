'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  useForm,
  type FieldErrors,
  type FieldValues,
  type Path,
  type Resolver,
  type UseFormReturn,
} from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
import { CountryCombobox } from '@/components/sis/country-combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { SensitiveInput } from '@/components/sis/sensitive-input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  buildFatherUpdateSchema,
  buildGuardianUpdateSchema,
  buildMotherUpdateSchema,
  FATHER_GATED_FIELDS,
  GUARDIAN_GATED_FIELDS,
  MARITAL_STATUS_OPTIONS,
  MOTHER_GATED_FIELDS,
  PARENT_GUARDIAN_PASS_TYPE_OPTIONS,
  RELIGION_OPTIONS,
  type FatherUpdateInput,
  type GuardianUpdateInput,
  type MotherUpdateInput,
  type ParentSlot,
} from '@/lib/schemas/sis';

type FieldKind =
  | 'text'
  | 'email'
  | 'date'
  | 'tribool'
  | 'select'
  | 'combobox'
  | 'password';
type FieldConfig = {
  name: string;
  label: string;
  kind?: FieldKind;
  wide?: boolean;
  /** Only used when kind === 'select' — bounded option list. */
  options?: readonly { label: string; value: string }[];
};

/**
 * The on-screen label for a field, prefixed by whose panel it sits in — the
 * three panels reuse the same labels ("Mobile" appears three times), so an
 * unqualified name would send the user to the wrong one.
 */
function labelForField(name: string): string {
  const who = name.startsWith('father')
    ? 'Father'
    : name.startsWith('mother')
      ? 'Mother'
      : name.startsWith('guardian')
        ? 'Guardian'
        : null;
  const match = FATHER_FIELDS.find(
    (f) =>
      f.name.replace(/^father/, '') ===
      name.replace(/^(father|mother|guardian)/, '')
  );
  const label = match?.label ?? name;
  return who ? `${who} — ${label}` : label;
}

const FATHER_FIELDS: FieldConfig[] = [
  { name: 'fatherFullName', label: 'Full name', wide: true },
  { name: 'fatherFirstName', label: 'First name' },
  { name: 'fatherMiddleName', label: 'Middle name' },
  { name: 'fatherLastName', label: 'Last name' },
  { name: 'fatherPreferredName', label: 'Preferred name' },
  { name: 'fatherNric', label: 'NRIC / FIN' },
  { name: 'fatherBirthDay', label: 'Date of birth', kind: 'date' },
  { name: 'fatherMobile', label: 'Mobile' },
  { name: 'fatherEmail', label: 'Email', kind: 'email', wide: true },
  { name: 'fatherNationality', label: 'Nationality', kind: 'combobox' },
  {
    name: 'fatherReligion',
    label: 'Religion',
    kind: 'select',
    options: RELIGION_OPTIONS,
  },
  { name: 'fatherReligionOther', label: 'Religion (other)' },
  {
    name: 'fatherMarital',
    label: 'Marital status',
    kind: 'select',
    options: MARITAL_STATUS_OPTIONS,
  },
  { name: 'fatherCompanyName', label: 'Company' },
  { name: 'fatherPosition', label: 'Position' },
  { name: 'fatherPassport', label: 'Passport', kind: 'password' },
  { name: 'fatherPassportExpiry', label: 'Passport expiry', kind: 'date' },
  {
    name: 'fatherPass',
    label: 'Pass type',
    kind: 'select',
    options: PARENT_GUARDIAN_PASS_TYPE_OPTIONS,
  },
  { name: 'fatherPassExpiry', label: 'Pass expiry', kind: 'date' },
  {
    name: 'fatherWhatsappTeamsConsent',
    label: 'WhatsApp / Teams consent',
    kind: 'tribool',
  },
];

const MOTHER_FIELDS: FieldConfig[] = FATHER_FIELDS.map((f) => ({
  ...f,
  name: f.name.replace(/^father/, 'mother'),
}));

// Guardian's schema (GuardianUpdateSchema) has near-full field parity with
// father's — derive the same way mother does, EXCEPT marital status:
// guardian never got a Marital column in the DDL (unlike father/mother), so
// GuardianUpdateSchema has no `guardianMarital` field. Filter out the
// father-only field before deriving, or the sheet would render a dead
// input that zod silently drops on submit.
const GUARDIAN_FIELDS: FieldConfig[] = FATHER_FIELDS.filter(
  (f) => f.name !== 'fatherMarital'
).map((f) => ({
  ...f,
  name: f.name.replace(/^father/, 'guardian'),
}));

const PARENT_LABELS: Record<ParentSlot, string> = {
  father: 'Father',
  mother: 'Mother',
  guardian: 'Guardian',
};

type ParentInput = FatherUpdateInput | MotherUpdateInput | GuardianUpdateInput;

// Mapped at runtime to dispatch validation per slot. Typed as `unknown` then
// re-cast inside the form because the three schemas form a discriminated union
// that zodResolver's overloads don't accept directly.
const BUILD_SCHEMA_BY_PARENT = {
  father: buildFatherUpdateSchema,
  mother: buildMotherUpdateSchema,
  guardian: buildGuardianUpdateSchema,
} as const;

const GATED_FIELDS_BY_PARENT: Record<ParentSlot, readonly string[]> = {
  father: FATHER_GATED_FIELDS,
  mother: MOTHER_GATED_FIELDS,
  guardian: GUARDIAN_GATED_FIELDS,
};

const FIELDS_BY_PARENT: Record<ParentSlot, FieldConfig[]> = {
  father: FATHER_FIELDS,
  mother: MOTHER_FIELDS,
  guardian: GUARDIAN_FIELDS,
};

export function EditFamilySheet({
  ayCode,
  enroleeNumber,
  parent,
  initial,
}: {
  ayCode: string;
  enroleeNumber: string;
  parent: ParentSlot;
  initial: Record<string, unknown>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const fields = FIELDS_BY_PARENT[parent];
  const defaults = buildDefaults(fields, initial);

  const form = useForm<ParentInput>({
    // ParentInput is a discriminated union across father/mother/guardian
    // schemas, but RHF wants a single concrete type. relaxedFamilyResolver
    // dispatches off the chosen `parent` slot (and, within that, off which
    // fields actually changed) at validation time.
    resolver: relaxedFamilyResolver(parent, defaults as ParentInput),
    defaultValues: defaults as ParentInput,
  });

  const saveMutation = useMutation({
    mutationFn: (values: ParentInput) =>
      apiFetch<{ changed?: number }>(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/family/${parent}?ay=${encodeURIComponent(ayCode)}`,
        jsonInit('PATCH', values)
      ),
    onSuccess: (body) => {
      const changed = body.changed as number | undefined;
      toast.success(
        changed === 0
          ? `${PARENT_LABELS[parent]} saved (no changes)`
          : `${PARENT_LABELS[parent]} updated (${changed} field${changed === 1 ? '' : 's'})`
      );
      setOpen(false);
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    },
  });

  // Awaited inside RHF's handleSubmit so `formState.isSubmitting` is the busy
  // signal.
  async function onSubmit(values: ParentInput) {
    await saveMutation.mutateAsync(values).catch(() => {});
  }

  // Reported 2026-08-14: "Save changes does nothing." `handleSubmit(onSubmit)`
  // with no second argument is SILENT when validation fails — no request, no
  // toast, nothing in the console. This sheet has three long parent panels, so
  // the offending field is very often scrolled out of sight along with its
  // inline message, and the button reads as dead.
  function onInvalid(errors: FieldErrors<ParentInput>) {
    const names = Object.keys(errors);
    if (names.length === 0) return;
    const labels = names.map(labelForField);
    const shown = labels.slice(0, 3).join(', ');
    toast.error(
      labels.length > 3
        ? `Check these fields: ${shown}, and ${labels.length - 3} more.`
        : `Check these fields: ${shown}.`
    );
    form.setFocus(names[0] as Path<ParentInput>);
  }

  const busy = form.formState.isSubmitting;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset(buildDefaults(fields, initial) as ParentInput);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Pencil className="size-3.5" />
          Edit
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-xl">
        <ScrollArea className="h-full">
          <SheetHeader className="space-y-2 border-b border-border p-6">
            <SheetTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Edit {PARENT_LABELS[parent].toLowerCase()}
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              Empty fields won&apos;t be saved.
            </SheetDescription>
          </SheetHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
              <div className="p-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {fields.map((cfg) => (
                    <SchemaField key={cfg.name} cfg={cfg} form={form} />
                  ))}
                </div>
              </div>

              <SheetFooter className="flex-row justify-end gap-2 border-t border-border p-6 sm:justify-end">
                <SheetClose asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                </SheetClose>
                <Button type="submit" size="sm" disabled={busy}>
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
                  {busy ? 'Saving…' : 'Save changes'}
                </Button>
              </SheetFooter>
            </form>
          </Form>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function buildDefaults(
  fields: FieldConfig[],
  initial: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    out[f.name] = initial[f.name] ?? null;
  }
  return out;
}

// Same reasoning as edit-profile-sheet.tsx's relaxedProfileResolver — skip
// the strict format refine on a gated field when it's unchanged from what
// was loaded, so a pre-existing legacy value on ANY parent slot doesn't
// block a save on an unrelated field.
function relaxedFamilyResolver(parent: ParentSlot, defaults: ParentInput) {
  return async (
    values: ParentInput,
    context: unknown,
    options: Parameters<Resolver<ParentInput>>[2]
  ) => {
    const gatedFields = GATED_FIELDS_BY_PARENT[parent];
    const changed = new Set(
      gatedFields.filter(
        (f) =>
          (values as Record<string, unknown>)[f] !==
          (defaults as Record<string, unknown>)[f]
      )
    );
    const buildSchema = BUILD_SCHEMA_BY_PARENT[parent];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolver = zodResolver(
      buildSchema(changed) as any
    ) as unknown as Resolver<ParentInput>;
    return resolver(values, context, options);
  };
}

function SchemaField<T extends FieldValues>({
  cfg,
  form,
}: {
  cfg: FieldConfig;
  form: UseFormReturn<T>;
}) {
  const kind = cfg.kind ?? 'text';
  const name = cfg.name as Path<T>;
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => {
        const wrapperClass = cfg.wide ? 'sm:col-span-2' : '';
        if (kind === 'tribool') {
          const v = field.value as boolean | null | undefined;
          const value =
            v === true ? 'yes' : v === false ? 'no' : UNSET_SENTINEL;
          return (
            <FormItem className={wrapperClass}>
              <FormLabel className="text-xs">{cfg.label}</FormLabel>
              <Select
                value={value}
                onValueChange={(next) =>
                  field.onChange(
                    next === 'yes' ? true : next === 'no' ? false : null
                  )
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET_SENTINEL}>Not set</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          );
        }
        if (kind === 'date') {
          return (
            <FormItem className={wrapperClass}>
              <FormLabel className="text-xs">{cfg.label}</FormLabel>
              <FormControl>
                <DatePicker
                  value={(field.value as string | null) ?? ''}
                  onChange={(next) => field.onChange(next === '' ? null : next)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          );
        }
        if (kind === 'select') {
          const v = field.value as string | null | undefined;
          const options = cfg.options ?? [];
          // Same handling as edit-profile-sheet.tsx's select branch, kept
          // identical on purpose: these are parent-portal-constrained lists
          // with no DB CHECK, so a legacy row can hold an off-list value.
          // Surface it as a "(current)" item rather than letting the trigger
          // render blank while real data sits underneath.
          const isKnown = v == null || options.some((o) => o.value === v);
          return (
            <FormItem className={wrapperClass}>
              <FormLabel className="text-xs">{cfg.label}</FormLabel>
              <Select
                value={v ?? UNSET_SENTINEL}
                onValueChange={(next) =>
                  field.onChange(next === UNSET_SENTINEL ? null : next)
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET_SENTINEL}>Not set</SelectItem>
                  {!isKnown && v && (
                    <SelectItem value={v}>{v} (current)</SelectItem>
                  )}
                  {options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          );
        }
        if (kind === 'combobox') {
          const v = field.value as string | null | undefined;
          return (
            <FormItem className={wrapperClass}>
              <FormLabel className="text-xs">{cfg.label}</FormLabel>
              <FormControl>
                <CountryCombobox
                  value={v ?? null}
                  onChange={(next) => field.onChange(next)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          );
        }
        if (kind === 'password') {
          return (
            <FormItem className={wrapperClass}>
              <FormLabel className="text-xs">{cfg.label}</FormLabel>
              <FormControl>
                <SensitiveInput
                  value={(field.value as string | null) ?? ''}
                  onChange={(next) => field.onChange(next === '' ? null : next)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          );
        }
        return (
          <FormItem className={wrapperClass}>
            <FormLabel className="text-xs">{cfg.label}</FormLabel>
            <FormControl>
              <Input
                type={kind === 'email' ? 'email' : 'text'}
                value={(field.value as string | null) ?? ''}
                onChange={(e) =>
                  field.onChange(e.target.value === '' ? null : e.target.value)
                }
                placeholder=""
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

// Radix Select rejects empty-string item values. Sentinel stays client-side
// only; onValueChange maps it back to null before RHF sees it.
// Radix Select forbids an empty-string item value, so "Not set" needs a
// sentinel mapped back to null on change. Shared by the tribool and select
// branches, matching edit-profile-sheet.tsx's single UNSET_SENTINEL.
const UNSET_SENTINEL = '__unset';
