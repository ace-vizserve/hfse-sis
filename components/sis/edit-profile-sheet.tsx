'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, type Resolver, type UseFormReturn } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
import { CountryCombobox } from '@/components/sis/country-combobox';
import { SensitiveInput } from '@/components/sis/sensitive-input';
import { DatePicker } from '@/components/ui/date-picker';
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
import { Textarea } from '@/components/ui/textarea';
import {
  buildProfileUpdateSchema,
  CONTRACT_SIGNATORY_OPTIONS,
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  PREFERRED_PAYMENT_METHOD_OPTIONS,
  PREFERRED_PAYMENT_SCHEME_OPTIONS,
  PREFERRED_SCHEDULE_OPTIONS,
  RELIGION_OPTIONS,
  STUDENT_CARE_PROGRAM_OPTIONS,
  STUDENT_PASS_TYPE_OPTIONS,
  PROFILE_GATED_FIELDS,
  type ProfileUpdateInput,
} from '@/lib/schemas/sis';

// Skips the strict format refine on a gated field (nric/nationality/
// phone/postal) when its submitted value hasn't changed from what was
// loaded — both edit sheets submit the WHOLE form on every save, so
// without this, an untouched legacy value would block saves on unrelated
// fields, contradicting this feature's "only bites on new writes" design.
function relaxedProfileResolver(
  defaults: ProfileUpdateInput
): Resolver<ProfileUpdateInput> {
  return async (values, context, options) => {
    const changed = new Set(
      PROFILE_GATED_FIELDS.filter(
        (f) =>
          (values as Record<string, unknown>)[f] !==
          (defaults as Record<string, unknown>)[f]
      )
    );
    const schema = buildProfileUpdateSchema(changed);
    return zodResolver(schema)(values, context, options);
  };
}

type FieldKind =
  | 'text'
  | 'textarea'
  | 'date'
  | 'tribool'
  | 'select'
  | 'combobox'
  | 'password';

type FieldConfig = {
  name: keyof ProfileUpdateInput;
  label: string;
  kind?: FieldKind;
  placeholder?: string;
  wide?: boolean;
  // Only used when kind === 'select' — bounded option list (e.g. payment
  // scheme/method, both parent-portal-constrained but not DB-enum-checked).
  options?: readonly { label: string; value: string }[];
  /** Discount slots only — which of discount1..3 this field is. */
  slot?: number;
};

type SectionConfig = {
  title: string;
  fields: FieldConfig[];
  /** Marks a section as slot-based, so the sheet draws only the slots that
   *  hold data plus an "add" control, instead of every slot always. */
  slotGroup?: 'sibling' | 'discount';
  /** Sibling sections only — which of siblings 1..5 this section is. */
  slot?: number;
};

const MAX_SIBLING_SLOTS = 5;
const MAX_DISCOUNT_SLOTS = 3;

/**
 * Which slots to draw: every slot that already holds data, plus any the user
 * has revealed this session.
 *
 * Keyed on the SLOT, never on a count. Production has 5 AY2026 rows where a
 * discount sits in slot 2 with slot 1 empty — "draw the first N" would hide
 * those values behind a form that still submits them, which is the worst of
 * both. Siblings have no sparse rows today, but the same rule costs nothing
 * and can't rot.
 */
export function filledSlots(
  initial: Partial<ProfileUpdateInput>,
  max: number,
  key: (n: number) => keyof ProfileUpdateInput
): number[] {
  const out: number[] = [];
  for (let n = 1; n <= max; n++) {
    const v = initial[key(n)];
    if (v !== null && v !== undefined && String(v).trim() !== '') out.push(n);
  }
  return out;
}

const SECTIONS: SectionConfig[] = [
  {
    title: 'Identity',
    fields: [
      { name: 'firstName', label: 'First name' },
      { name: 'middleName', label: 'Middle name' },
      { name: 'lastName', label: 'Last name' },
      { name: 'preferredName', label: 'Preferred name' },
      { name: 'enroleeFullName', label: 'Full name (override)', wide: true },
      { name: 'category', label: 'Category' },
      { name: 'nric', label: 'NRIC / FIN' },
      { name: 'birthDay', label: 'Date of birth', kind: 'date' },
      {
        name: 'gender',
        label: 'Gender',
        kind: 'select',
        options: GENDER_OPTIONS,
      },
      { name: 'nationality', label: 'Nationality', kind: 'combobox' },
      { name: 'primaryLanguage', label: 'Primary language' },
      {
        name: 'religion',
        label: 'Religion',
        kind: 'select',
        options: RELIGION_OPTIONS,
      },
      { name: 'religionOther', label: 'Religion (other)' },
    ],
  },
  {
    title: 'Travel documents',
    fields: [
      // Only the passport NUMBER is masked. `pass` is the immigration pass
      // TYPE (Student Pass, Dependent Pass, …) — a category, not a credential,
      // so masking it hid useful information behind a reveal click and let the
      // value drift as free text. It's a constrained picker now.
      { name: 'passportNumber', label: 'Passport number', kind: 'password' },
      { name: 'passportExpiry', label: 'Passport expiry', kind: 'date' },
      {
        name: 'pass',
        label: 'Pass type',
        kind: 'select',
        options: STUDENT_PASS_TYPE_OPTIONS,
      },
      { name: 'passExpiry', label: 'Pass expiry', kind: 'date' },
    ],
  },
  {
    title: 'Contact',
    fields: [
      { name: 'homePhone', label: 'Home phone' },
      {
        name: 'homeAddress',
        label: 'Home address',
        kind: 'textarea',
        wide: true,
      },
      { name: 'postalCode', label: 'Postal code' },
      { name: 'livingWithWhom', label: 'Living with' },
      { name: 'contactPerson', label: 'Contact person' },
      { name: 'contactPersonNumber', label: 'Contact number' },
      {
        name: 'parentMaritalStatus',
        label: 'Parent marital status',
        kind: 'select',
        options: MARITAL_STATUS_OPTIONS,
      },
    ],
  },
  {
    title: 'Application preferences',
    fields: [
      { name: 'levelApplied', label: 'Level applied' },
      {
        name: 'preferredSchedule',
        label: 'Preferred schedule',
        kind: 'select',
        options: PREFERRED_SCHEDULE_OPTIONS,
      },
      { name: 'classType', label: 'Class type' },
      { name: 'paymentOption', label: 'Payment option' },
      {
        name: 'preferredPaymentScheme',
        label: 'Payment scheme',
        kind: 'select',
        options: PREFERRED_PAYMENT_SCHEME_OPTIONS,
      },
      {
        name: 'preferredPaymentMethod',
        label: 'Payment method',
        kind: 'select',
        options: PREFERRED_PAYMENT_METHOD_OPTIONS,
      },
      { name: 'availSchoolBus', label: 'School bus', kind: 'tribool' },
      { name: 'availStudentCare', label: 'Student care', kind: 'tribool' },
      {
        name: 'studentCareProgram',
        label: 'Student care program',
        kind: 'select',
        options: STUDENT_CARE_PROGRAM_OPTIONS,
      },
      { name: 'availUniform', label: 'Uniform', kind: 'tribool' },
      {
        name: 'additionalLearningNeeds',
        label: 'Additional learning needs',
        kind: 'textarea',
        wide: true,
      },
      {
        name: 'otherLearningNeeds',
        label: 'Other learning needs',
        kind: 'textarea',
        wide: true,
      },
      { name: 'previousSchool', label: 'Previous school' },
      { name: 'howDidYouKnowAboutHFSEIS', label: 'Referral source' },
      { name: 'otherSource', label: 'Other source' },
      // "How did you know about HFSE" attribution — distinct from the
      // referrerName/referrerMobile pair below, which is a discount-code
      // referral (unrelated concept).
      { name: 'marketingReferrerName', label: 'Referral name' },
      { name: 'referrerName', label: 'Referrer name (discount code)' },
      { name: 'referrerMobile', label: 'Referrer mobile (discount code)' },
      {
        name: 'contractSignatory',
        label: 'Contract signatory',
        kind: 'select',
        options: CONTRACT_SIGNATORY_OPTIONS,
      },
    ],
  },
  // Discount + sibling slots are fixed DB columns (discount1..3,
  // sibling*1..5), so they stay declared in full here — buildDefaults walks
  // this list and every slot must be present in the submitted form, whether or
  // not the sheet draws it. Which ones are DRAWN is decided at render time by
  // `visibleSlots` below; hiding a slot never changes what is saved.
  {
    title: 'Discount slots',
    slotGroup: 'discount',
    fields: [
      { name: 'discount1', label: 'Discount 1', slot: 1 },
      { name: 'discount2', label: 'Discount 2', slot: 2 },
      { name: 'discount3', label: 'Discount 3', slot: 3 },
    ],
  },
  ...([1, 2, 3, 4, 5] as const).map(
    (n): SectionConfig => ({
      title: `Sibling ${n}`,
      slotGroup: 'sibling',
      slot: n,
      fields: [
        {
          name: `siblingFullName${n}` as keyof ProfileUpdateInput,
          label: 'Full name',
          wide: true,
        },
        {
          name: `siblingBirthDay${n}` as keyof ProfileUpdateInput,
          label: 'Date of birth',
          kind: 'date',
        },
        {
          name: `siblingReligion${n}` as keyof ProfileUpdateInput,
          label: 'Religion',
        },
        {
          name: `siblingEducationOccupation${n}` as keyof ProfileUpdateInput,
          label: 'Education / occupation',
        },
        {
          name: `siblingSchoolCompany${n}` as keyof ProfileUpdateInput,
          label: 'School / company',
        },
      ],
    })
  ),
];

export function EditProfileSheet({
  ayCode,
  enroleeNumber,
  initial,
}: {
  ayCode: string;
  enroleeNumber: string;
  initial: Partial<ProfileUpdateInput>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Slots drawn this session: those with data, plus any revealed by "Add".
  // Never resets on save — only on close, alongside the form reset below.
  const [shownSiblings, setShownSiblings] = useState<number[]>(() =>
    filledSlots(
      initial,
      MAX_SIBLING_SLOTS,
      (n) => `siblingFullName${n}` as keyof ProfileUpdateInput
    )
  );
  const [shownDiscounts, setShownDiscounts] = useState<number[]>(() =>
    filledSlots(
      initial,
      MAX_DISCOUNT_SLOTS,
      (n) => `discount${n}` as keyof ProfileUpdateInput
    )
  );

  // Reveal the lowest slot not already drawn — which, on a sparse row, is the
  // empty gap before a filled slot rather than the one after it.
  function revealNext(shown: number[], max: number): number[] {
    for (let n = 1; n <= max; n++) if (!shown.includes(n)) return [...shown, n];
    return shown;
  }

  const defaults = buildDefaults(initial);
  const form = useForm<ProfileUpdateInput>({
    resolver: relaxedProfileResolver(defaults),
    defaultValues: defaults,
  });

  const saveMutation = useMutation({
    mutationFn: (values: ProfileUpdateInput) =>
      apiFetch<{ changed?: number }>(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/profile?ay=${encodeURIComponent(ayCode)}`,
        jsonInit('PATCH', values)
      ),
    onSuccess: (body) => {
      const changed = body.changed as number | undefined;
      toast.success(
        changed === 0
          ? 'Profile saved (no changes)'
          : `Profile updated (${changed} field${changed === 1 ? '' : 's'})`
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
  async function onSubmit(values: ProfileUpdateInput) {
    await saveMutation.mutateAsync(values).catch(() => {});
  }

  const busy = form.formState.isSubmitting;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          form.reset(buildDefaults(initial));
          // Revealed-but-unfilled slots fold away again with the form values
          // they would have held, so reopening doesn't show a blank slot the
          // registrar abandoned. `initial` is the prop, so a slot the user
          // actually filled and SAVED comes back via the parent's refresh.
          setShownSiblings(
            filledSlots(
              initial,
              MAX_SIBLING_SLOTS,
              (n) => `siblingFullName${n}` as keyof ProfileUpdateInput
            )
          );
          setShownDiscounts(
            filledSlots(
              initial,
              MAX_DISCOUNT_SLOTS,
              (n) => `discount${n}` as keyof ProfileUpdateInput
            )
          );
        }
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Pencil className="size-3.5" />
          Edit profile
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-2xl">
        <ScrollArea className="h-full">
          <SheetHeader className="space-y-2 border-b border-border p-6">
            <SheetTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Edit profile
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              Updates demographic and preference fields on{' '}
              <span className="font-mono text-foreground">
                {ayCode.toLowerCase()}_enrolment_applications
              </span>
              . Stable IDs (enrolee number, student number) are not editable.
            </SheetDescription>
          </SheetHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="space-y-8 p-6">
                {SECTIONS.map((section) => {
                  // Sibling slot: drawn only when it holds data or was added.
                  if (section.slotGroup === 'sibling') {
                    if (!shownSiblings.includes(section.slot ?? 0)) return null;
                  }

                  // Discount slots share one section, so filter the FIELDS and
                  // keep the section (it owns the add control + empty state).
                  const fields =
                    section.slotGroup === 'discount'
                      ? section.fields.filter((f) =>
                          shownDiscounts.includes(f.slot ?? 0)
                        )
                      : section.fields;

                  const isDiscounts = section.slotGroup === 'discount';
                  const canAddDiscount =
                    isDiscounts && shownDiscounts.length < MAX_DISCOUNT_SLOTS;

                  return (
                    <section key={section.title} className="space-y-3">
                      <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
                        {section.title}
                      </h3>
                      {isDiscounts && fields.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No discount codes on this application.
                        </p>
                      )}
                      {fields.length > 0 && (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          {fields.map((cfg) => (
                            <SchemaField key={cfg.name} cfg={cfg} form={form} />
                          ))}
                        </div>
                      )}
                      {canAddDiscount && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() =>
                            setShownDiscounts((s) =>
                              revealNext(s, MAX_DISCOUNT_SLOTS)
                            )
                          }
                        >
                          <Plus className="size-3.5" />
                          Add a discount code
                        </Button>
                      )}
                    </section>
                  );
                })}

                {/* Siblings: an empty state + add control, so a student with
                    none on file still has a way in. Previously all 5 slots
                    rendered always — ~214 of 497 AY2026 applicants have no
                    siblings at all, and nobody has more than 3. */}
                <section className="space-y-3">
                  {shownSiblings.length === 0 && (
                    <>
                      <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
                        Siblings
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        No siblings on file.
                      </p>
                    </>
                  )}
                  {shownSiblings.length < MAX_SIBLING_SLOTS && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() =>
                        setShownSiblings((s) =>
                          revealNext(s, MAX_SIBLING_SLOTS)
                        )
                      }
                    >
                      <Plus className="size-3.5" />
                      {shownSiblings.length === 0
                        ? 'Add a sibling'
                        : 'Add another sibling'}
                    </Button>
                  )}
                </section>
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

// Build a defaults object matching every field on the schema. Anything missing
// from the input maps to null so RHF doesn't see "uncontrolled" warnings.
function buildDefaults(
  initial: Partial<ProfileUpdateInput>
): ProfileUpdateInput {
  const out: Record<string, unknown> = {};
  for (const section of SECTIONS) {
    for (const f of section.fields) {
      out[f.name] = initial[f.name] ?? null;
    }
  }
  return out as ProfileUpdateInput;
}

// Radix Select rejects empty-string item values. Sentinel stays client-side
// only; onValueChange maps it back to null before RHF sees it. Shared by
// both the tribool (Yes/No/Not set) and generic options-driven selects.
const UNSET_SENTINEL = '__unset';

function SchemaField({
  cfg,
  form,
}: {
  cfg: FieldConfig;
  form: UseFormReturn<ProfileUpdateInput>;
}) {
  const kind = cfg.kind ?? 'text';
  return (
    <FormField
      control={form.control}
      name={cfg.name}
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
        if (kind === 'select') {
          const v = field.value as string | null | undefined;
          const options = cfg.options ?? [];
          // These are parent-portal-constrained lists, not DB-enum-checked
          // (lib/schemas/sis.ts) — a stored value can in principle be
          // outside the known options. Surface it as an extra item instead
          // of letting the trigger render blank while real data sits
          // underneath.
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
                  placeholder={cfg.placeholder ?? ''}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          );
        }
        if (kind === 'textarea') {
          return (
            <FormItem className={wrapperClass}>
              <FormLabel className="text-xs">{cfg.label}</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  value={(field.value as string | null) ?? ''}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value === '' ? null : e.target.value
                    )
                  }
                  placeholder={cfg.placeholder ?? ''}
                />
              </FormControl>
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
        return (
          <FormItem className={wrapperClass}>
            <FormLabel className="text-xs">{cfg.label}</FormLabel>
            <FormControl>
              <Input
                type="text"
                value={(field.value as string | null) ?? ''}
                onChange={(e) =>
                  field.onChange(e.target.value === '' ? null : e.target.value)
                }
                placeholder={cfg.placeholder ?? ''}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
