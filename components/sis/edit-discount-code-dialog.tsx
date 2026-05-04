'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, Tag } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
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
  DISCOUNT_ENROLEE_TYPES,
  DiscountCodeSchema,
  type DiscountCodeInput,
  type DiscountEnroleeType,
} from '@/lib/schemas/sis';

type Mode = 'create' | 'edit';

type Props = {
  /** Initial AY for the dialog. In create mode the user can change this via
   *  the AY picker; in edit mode the AY is locked (the row lives in a
   *  specific `ay{YYYY}_discount_codes` table and moving it cross-table is
   *  not supported). */
  ayCode: string;
  mode: Mode;
  /** Every AY currently in the `academic_years` table — same source as
   *  `<AySwitcher>`. Only used in create mode (the dropdown lists all AYs
   *  so the registrar can pick the target year). Ignored in edit mode. */
  ayCodes?: readonly string[];
  /** Required when mode is 'edit' — row identity on the server */
  id?: number | string;
  /** Required when mode is 'edit' — seed the form with existing values */
  initial?: DiscountCodeInput;
  /** Trigger element — e.g. "New code" button or dropdown menu item */
  children: ReactNode;
};

const BLANK: DiscountCodeInput = {
  discountCode: '',
  enroleeType: 'New',
  startDate: null,
  endDate: null,
  details: null,
};

export function EditDiscountCodeDialog({ ayCode, mode, ayCodes, id, initial, children }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Create mode lets the registrar pick which AY this code lands in. Edit
  // mode locks the AY (the row physically lives in `ay{YYYY}_discount_codes`
  // and moving cross-AY isn't supported).
  const [targetAy, setTargetAy] = useState(ayCode);

  const defaults = mode === 'edit' && initial ? initial : BLANK;

  const form = useForm<DiscountCodeInput>({
    resolver: zodResolver(DiscountCodeSchema),
    defaultValues: defaults,
  });

  // Same source as <AySwitcher>: every AY currently in `academic_years`.
  // Falls back to a single-entry list when the parent didn't pass any.
  const ayOptions: readonly string[] =
    ayCodes && ayCodes.length > 0 ? ayCodes : [ayCode];
  const showPicker = mode === 'create';

  async function onSubmit(values: DiscountCodeInput) {
    try {
      const isEdit = mode === 'edit';
      const writeAy = isEdit ? ayCode : targetAy;
      const url = isEdit
        ? `/api/sis/discount-codes/${encodeURIComponent(String(id))}?ay=${encodeURIComponent(writeAy)}`
        : `/api/sis/discount-codes?ay=${encodeURIComponent(writeAy)}`;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to save');
      toast.success(
        isEdit ? 'Discount code updated' : `Discount code created in ${writeAy}`,
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
        if (!next) form.reset(defaults);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5 text-left">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Discount codes
              </p>
              <DialogTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                {mode === 'create' ? 'New discount code' : 'Edit discount code'}
              </DialogTitle>
            </div>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Tag className="size-4" />
            </div>
          </div>
          <DialogDescription>
            {mode === 'create'
              ? `Creates a discount code for ${showPicker ? targetAy : ayCode}. The enrolment portal picks it up immediately.`
              : 'To take a code offline, use "Expire" instead of editing the end date.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {showPicker && (
              <div className="space-y-2">
                <label
                  htmlFor="discount-code-ay-picker"
                  className="text-sm font-medium leading-none text-foreground">
                  Apply to AY
                </label>
                <Select value={targetAy} onValueChange={(v) => setTargetAy(v)}>
                  <SelectTrigger id="discount-code-ay-picker">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ayOptions.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <FormField
              control={form.control}
              name="discountCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="off"
                      placeholder="EARLYBIRD2027"
                      className="font-mono uppercase tracking-wider"
                      maxLength={60}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="enroleeType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Eligibility</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => field.onChange(v as DiscountEnroleeType)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {DISCOUNT_ENROLEE_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start date</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={field.value ?? ''}
                        onChange={(v) => field.onChange(v === '' ? null : v)}
                        placeholder="Select start date"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End date</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={field.value ?? ''}
                        onChange={(v) => field.onChange(v === '' ? null : v)}
                        placeholder="Select end date"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="details"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Details</FormLabel>
                  <FormControl>
                    <Textarea
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                      rows={3}
                      placeholder="Internal notes on who this code is for, how much it's worth, etc."
                      maxLength={2000}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {busy ? 'Saving…' : mode === 'create' ? 'Create code' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function NewDiscountCodeButton({
  ayCode,
  ayCodes,
}: {
  ayCode: string;
  ayCodes?: readonly string[];
}) {
  return (
    <EditDiscountCodeDialog ayCode={ayCode} mode="create" ayCodes={ayCodes}>
      <Button size="sm" className="gap-1.5">
        <Plus className="size-3.5" />
        New code
      </Button>
    </EditDiscountCodeDialog>
  );
}
