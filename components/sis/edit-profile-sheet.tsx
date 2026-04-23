'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
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
import { ProfileUpdateSchema, type ProfileUpdateInput } from '@/lib/schemas/sis';

type FieldKind = 'text' | 'textarea' | 'date' | 'tribool';

type FieldConfig = {
  name: keyof ProfileUpdateInput;
  label: string;
  kind?: FieldKind;
  placeholder?: string;
  wide?: boolean;
};

type SectionConfig = { title: string; fields: FieldConfig[] };

const SECTIONS: SectionConfig[] = [
  {
    title: 'Identity',
    fields: [
      { name: 'firstName',       label: 'First name' },
      { name: 'middleName',      label: 'Middle name' },
      { name: 'lastName',        label: 'Last name' },
      { name: 'preferredName',   label: 'Preferred name' },
      { name: 'enroleeFullName', label: 'Full name (override)', wide: true },
      { name: 'category',        label: 'Category' },
      { name: 'nric',            label: 'NRIC / FIN' },
      { name: 'birthDay',        label: 'Date of birth', kind: 'date' },
      { name: 'gender',          label: 'Gender' },
      { name: 'nationality',     label: 'Nationality' },
      { name: 'primaryLanguage', label: 'Primary language' },
      { name: 'religion',        label: 'Religion' },
      { name: 'religionOther',   label: 'Religion (other)' },
    ],
  },
  {
    title: 'Travel documents',
    fields: [
      { name: 'passportNumber', label: 'Passport number' },
      { name: 'passportExpiry', label: 'Passport expiry', kind: 'date' },
      { name: 'pass',           label: 'Pass type' },
      { name: 'passExpiry',     label: 'Pass expiry', kind: 'date' },
    ],
  },
  {
    title: 'Contact',
    fields: [
      { name: 'homePhone',           label: 'Home phone' },
      { name: 'homeAddress',         label: 'Home address', kind: 'textarea', wide: true },
      { name: 'postalCode',          label: 'Postal code' },
      { name: 'livingWithWhom',      label: 'Living with' },
      { name: 'contactPerson',       label: 'Contact person' },
      { name: 'contactPersonNumber', label: 'Contact number' },
      { name: 'parentMaritalStatus', label: 'Parent marital status' },
    ],
  },
  {
    title: 'Application preferences',
    fields: [
      { name: 'levelApplied',             label: 'Level applied' },
      { name: 'preferredSchedule',        label: 'Preferred schedule' },
      { name: 'classType',                label: 'Class type' },
      { name: 'paymentOption',            label: 'Payment option' },
      { name: 'availSchoolBus',           label: 'School bus', kind: 'tribool' },
      { name: 'availStudentCare',         label: 'Student care', kind: 'tribool' },
      { name: 'studentCareProgram',       label: 'Student care program' },
      { name: 'availUniform',             label: 'Uniform', kind: 'tribool' },
      { name: 'additionalLearningNeeds',  label: 'Additional learning needs', kind: 'textarea', wide: true },
      { name: 'otherLearningNeeds',       label: 'Other learning needs', kind: 'textarea', wide: true },
      { name: 'previousSchool',           label: 'Previous school' },
      { name: 'howDidYouKnowAboutHFSEIS', label: 'Referral source' },
      { name: 'otherSource',              label: 'Other source' },
      { name: 'referrerName',             label: 'Referrer name' },
      { name: 'referrerMobile',           label: 'Referrer mobile' },
      { name: 'contractSignatory',        label: 'Contract signatory' },
    ],
  },
  {
    title: 'Discount slots',
    fields: [
      { name: 'discount1', label: 'Discount 1' },
      { name: 'discount2', label: 'Discount 2' },
      { name: 'discount3', label: 'Discount 3' },
    ],
  },
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

  const defaults = buildDefaults(initial);
  const form = useForm<ProfileUpdateInput>({
    resolver: zodResolver(ProfileUpdateSchema),
    defaultValues: defaults,
  });

  async function onSubmit(values: ProfileUpdateInput) {
    try {
      const res = await fetch(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/profile?ay=${encodeURIComponent(ayCode)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(values),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to save');
      const changed = body.changed as number | undefined;
      toast.success(
        changed === 0 ? 'Profile saved (no changes)' : `Profile updated (${changed} field${changed === 1 ? '' : 's'})`,
      );
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    }
  }

  const busy = form.formState.isSubmitting;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset(buildDefaults(initial));
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
              <span className="font-mono text-foreground">{ayCode.toLowerCase()}_enrolment_applications</span>.
              Stable IDs (enrolee number, student number) are not editable.
            </SheetDescription>
          </SheetHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="space-y-8 p-6">
                {SECTIONS.map((section) => (
                  <section key={section.title} className="space-y-3">
                    <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
                      {section.title}
                    </h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {section.fields.map((cfg) => (
                        <SchemaField key={cfg.name} cfg={cfg} form={form} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              <SheetFooter className="flex-row justify-end gap-2 border-t border-border p-6 sm:justify-end">
                <SheetClose asChild>
                  <Button type="button" variant="outline" size="sm" disabled={busy}>
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
function buildDefaults(initial: Partial<ProfileUpdateInput>): ProfileUpdateInput {
  const out: Record<string, unknown> = {};
  for (const section of SECTIONS) {
    for (const f of section.fields) {
      out[f.name] = initial[f.name] ?? null;
    }
  }
  return out as ProfileUpdateInput;
}

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
          const value = v === true ? 'yes' : v === false ? 'no' : '';
          return (
            <FormItem className={wrapperClass}>
              <FormLabel className="text-xs">{cfg.label}</FormLabel>
              <Select
                value={value}
                onValueChange={(next) => field.onChange(next === 'yes' ? true : next === 'no' ? false : null)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Not set</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
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
                  onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                  placeholder={cfg.placeholder ?? ''}
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
                type={kind === 'date' ? 'date' : 'text'}
                value={(field.value as string | null) ?? ''}
                onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                placeholder={kind === 'date' ? 'YYYY-MM-DD' : (cfg.placeholder ?? '')}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
