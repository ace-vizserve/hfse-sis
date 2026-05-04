'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, type FieldValues, type Path, type Resolver, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
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
import {
  FatherUpdateSchema,
  GuardianUpdateSchema,
  MotherUpdateSchema,
  type FatherUpdateInput,
  type GuardianUpdateInput,
  type MotherUpdateInput,
  type ParentSlot,
} from '@/lib/schemas/sis';

type FieldKind = 'text' | 'email' | 'date' | 'tribool';
type FieldConfig = { name: string; label: string; kind?: FieldKind; wide?: boolean };

const FATHER_FIELDS: FieldConfig[] = [
  { name: 'fatherFullName',  label: 'Full name', wide: true },
  { name: 'fatherFirstName', label: 'First name' },
  { name: 'fatherLastName',  label: 'Last name' },
  { name: 'fatherNric',      label: 'NRIC / FIN' },
  { name: 'fatherBirthDay',  label: 'Date of birth', kind: 'date' },
  { name: 'fatherMobile',    label: 'Mobile' },
  { name: 'fatherEmail',     label: 'Email', kind: 'email', wide: true },
  { name: 'fatherNationality', label: 'Nationality' },
  { name: 'fatherCompanyName', label: 'Company' },
  { name: 'fatherPosition',    label: 'Position' },
  { name: 'fatherPassport',       label: 'Passport' },
  { name: 'fatherPassportExpiry', label: 'Passport expiry', kind: 'date' },
  { name: 'fatherPass',           label: 'Pass type' },
  { name: 'fatherPassExpiry',     label: 'Pass expiry', kind: 'date' },
  { name: 'fatherWhatsappTeamsConsent', label: 'WhatsApp / Teams consent', kind: 'tribool' },
];

const MOTHER_FIELDS: FieldConfig[] = FATHER_FIELDS.map((f) => ({
  ...f,
  name: f.name.replace(/^father/, 'mother'),
}));

const GUARDIAN_FIELDS: FieldConfig[] = [
  { name: 'guardianFullName',     label: 'Full name', wide: true },
  { name: 'guardianMobile',       label: 'Mobile' },
  { name: 'guardianEmail',        label: 'Email', kind: 'email', wide: true },
  { name: 'guardianNationality',  label: 'Nationality' },
  { name: 'guardianPassport',     label: 'Passport' },
  { name: 'guardianPassportExpiry', label: 'Passport expiry', kind: 'date' },
  { name: 'guardianPass',         label: 'Pass type' },
  { name: 'guardianPassExpiry',   label: 'Pass expiry', kind: 'date' },
  { name: 'guardianWhatsappTeamsConsent', label: 'WhatsApp / Teams consent', kind: 'tribool' },
];

const PARENT_LABELS: Record<ParentSlot, string> = {
  father: 'Father',
  mother: 'Mother',
  guardian: 'Guardian',
};

type ParentInput = FatherUpdateInput | MotherUpdateInput | GuardianUpdateInput;

// Mapped at runtime to dispatch validation per slot. Typed as `unknown` then
// re-cast inside the form because the three schemas form a discriminated union
// that zodResolver's overloads don't accept directly.
const SCHEMA_BY_PARENT = {
  father: FatherUpdateSchema,
  mother: MotherUpdateSchema,
  guardian: GuardianUpdateSchema,
} as const;

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
  const schema = SCHEMA_BY_PARENT[parent];
  const defaults = buildDefaults(fields, initial);

  const form = useForm<ParentInput>({
    // Cast: ParentInput is a discriminated union across father/mother/guardian
    // schemas, but RHF wants a single concrete type. The runtime resolver
    // dispatches off the chosen `parent` slot anyway.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any) as unknown as Resolver<ParentInput>,
    defaultValues: defaults as ParentInput,
  });

  async function onSubmit(values: ParentInput) {
    try {
      const res = await fetch(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/family/${parent}?ay=${encodeURIComponent(ayCode)}`,
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
        changed === 0
          ? `${PARENT_LABELS[parent]} saved (no changes)`
          : `${PARENT_LABELS[parent]} updated (${changed} field${changed === 1 ? '' : 's'})`,
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
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="p-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {fields.map((cfg) => (
                    <SchemaField key={cfg.name} cfg={cfg} form={form} />
                  ))}
                </div>
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

function buildDefaults(fields: FieldConfig[], initial: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    out[f.name] = initial[f.name] ?? null;
  }
  return out;
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
          const value = v === true ? 'yes' : v === false ? 'no' : TRIBOOL_UNSET;
          return (
            <FormItem className={wrapperClass}>
              <FormLabel className="text-xs">{cfg.label}</FormLabel>
              <Select
                value={value}
                onValueChange={(next) =>
                  field.onChange(next === 'yes' ? true : next === 'no' ? false : null)
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TRIBOOL_UNSET}>Not set</SelectItem>
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
        return (
          <FormItem className={wrapperClass}>
            <FormLabel className="text-xs">{cfg.label}</FormLabel>
            <FormControl>
              <Input
                type={kind === 'email' ? 'email' : 'text'}
                value={(field.value as string | null) ?? ''}
                onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
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
const TRIBOOL_UNSET = '__unset';
