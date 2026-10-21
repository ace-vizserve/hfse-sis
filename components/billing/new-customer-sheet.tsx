'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';

import {
  NewCustomerFields,
  useNewCustomerForm,
} from '@/components/billing/new-customer-form';
import { SheetSection } from '@/components/billing/sheet-section';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { NewCustomerStudent } from '@/lib/billing/new-customer';
import { apiFetch } from '@/lib/query/fetcher';
import { cn } from '@/lib/utils';

// Billing → New customer: pick a student with no QuickBooks customer, check
// the form (filled from their newest application), add it to QuickBooks —
// linked to the student in the same step. A customer always belongs to a
// student here: one with none would never show in Billing.

export function NewCustomerSheet({
  open,
  onOpenChange,
  student: preset,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Open on this student (To review's row ▾); omitted = staff pick one. */
  student?: { studentNumber: string; name: string } | null;
}) {
  const [picked, setPicked] = useState<{
    studentNumber: string;
    name: string;
  } | null>(preset ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const students = useQuery({
    queryKey: ['billing-new-customer-students'],
    queryFn: () =>
      apiFetch<{ students: NewCustomerStudent[] }>('/api/billing/new-customer'),
    enabled: open && !preset,
  });
  const f = useNewCustomerForm({
    studentNumber: picked?.studentNumber ?? null,
    enabled: open,
  });
  const { form, saving } = f;
  const [pickedMissing, setPickedMissing] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) {
      setPickedMissing(true);
      return;
    }
    await f.submit({ onResolved: () => onOpenChange(false) });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Customers
            </p>
            <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
              New customer
            </SheetTitle>
            <SheetDescription>
              A QuickBooks customer for a student who has none yet, filled in
              from their application. Check it, then add it — it is linked to
              the student straight away.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
            <SheetSection title="Student">
              {preset ? (
                <p className="text-sm text-foreground">
                  {preset.name}{' '}
                  <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                    {preset.studentNumber}
                  </span>
                </p>
              ) : (
                <Field>
                  <FieldLabel htmlFor="new-student" className="sr-only">
                    Student
                  </FieldLabel>
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id="new-student"
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={pickerOpen}
                        aria-invalid={pickedMissing && !picked}
                        className="w-full justify-between font-normal"
                      >
                        <span
                          className={cn(
                            'truncate',
                            !picked && 'text-muted-foreground'
                          )}
                        >
                          {picked
                            ? `${picked.name} · ${picked.studentNumber}`
                            : students.isLoading
                              ? 'Loading students…'
                              : 'Choose a student'}
                        </span>
                        <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-(--radix-popover-trigger-width) p-0"
                    >
                      <Command>
                        <CommandInput placeholder="Name or student number" />
                        <CommandList>
                          <CommandEmpty>
                            No student without a customer by that name.
                          </CommandEmpty>
                          {(students.data?.students ?? []).map((s) => (
                            <CommandItem
                              key={s.studentNumber}
                              value={`${s.name} ${s.studentNumber}`}
                              onSelect={() => {
                                setPicked({
                                  studentNumber: s.studentNumber,
                                  name: s.name,
                                });
                                setPickerOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  'size-4',
                                  picked?.studentNumber === s.studentNumber
                                    ? 'opacity-100'
                                    : 'opacity-0'
                                )}
                              />
                              <span className="flex-1 truncate">{s.name}</span>
                              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                {s.studentNumber}
                                {s.ayCode ? ` · ${s.ayCode}` : ''}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FieldDescription>
                    Only students with no QuickBooks customer are listed.
                  </FieldDescription>
                  {students.isError && (
                    <FieldError>{(students.error as Error).message}</FieldError>
                  )}
                  {pickedMissing && !picked && (
                    <FieldError>Choose the student first.</FieldError>
                  )}
                </Field>
              )}
            </SheetSection>

            {picked && <NewCustomerFields f={f} />}
          </div>

          <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border bg-background px-6 py-4">
            <SheetClose asChild>
              <Button type="button" variant="outline" disabled={saving}>
                Cancel
              </Button>
            </SheetClose>
            <Button
              type="submit"
              loading={saving}
              loadingText="Adding…"
              disabled={saving || (!!picked && !form)}
            >
              Add to QuickBooks
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
