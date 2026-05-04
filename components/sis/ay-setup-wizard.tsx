'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Plus } from 'lucide-react';
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { CreateAySchema, type CreateAyInput } from '@/lib/schemas/ay-setup';
import { TEMPLATE_SOURCE_SENTINEL } from '@/lib/sis/ay-setup/constants';

// Source string from getCopyForwardPreview is either a real AY code
// (`'AY2026'`) or the sentinel — render the sentinel as the human label.
function formatSource(sourceAyCode: string): string {
  return sourceAyCode === TEMPLATE_SOURCE_SENTINEL ? 'template' : sourceAyCode;
}

type Preview = {
  source_ay_code: string | null;
  sections_to_copy: number;
  subject_configs_to_copy: number;
  ay_already_exists: boolean;
  terms_to_insert: number;
};

type Props = {
  preview: Preview;
  children: ReactNode;
};

type Step = 'identity' | 'review' | 'follow-up';

const BLANK: CreateAyInput = { ay_code: '', label: '', accepting_applications: false };

export function AySetupWizard({ preview, children }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('identity');
  const [createdAyCode, setCreatedAyCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CreateAyInput>({
    resolver: zodResolver(CreateAySchema),
    defaultValues: BLANK,
  });

  function resetAll() {
    form.reset(BLANK);
    setStep('identity');
    setCreatedAyCode(null);
    setSubmitting(false);
  }

  async function onStep1Submit(values: CreateAyInput) {
    // Step 1 only validates — the actual commit happens on step 2.
    setStep('review');
  }

  async function onCommit() {
    const values = form.getValues();
    setSubmitting(true);
    try {
      const res = await fetch('/api/sis/ay-setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to create AY');
      if (body.alreadyExisted) {
        toast.info(`${values.ay_code} is already fully set up — nothing to do.`);
        handleOpenChange(false);
        router.refresh();
        return;
      }
      // The RPC is idempotent (migration 030). When `summary.ay_existed`
      // is true here it means we filled in missing terms / sections /
      // subject_configs against an already-existing AY row — phrase it
      // as "completed" rather than "created" so the user understands
      // their existing admissions data wasn't disturbed.
      const ayExisted = body.summary?.ay_existed === true;
      toast.success(
        ayExisted ? `${values.ay_code} setup completed` : `${values.ay_code} created`,
      );
      setCreatedAyCode(values.ay_code);
      setStep('follow-up');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create AY');
    } finally {
      setSubmitting(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetAll();
  }

  const ayCode = form.watch('ay_code')?.trim().toUpperCase() || '';
  const aySlug = /^AY\d{4}$/.test(ayCode) ? `ay${ayCode.slice(2).toLowerCase()}` : 'ay____';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {step === 'identity' && (
          <>
            <DialogHeader>
              <DialogTitle>Create a new academic year</DialogTitle>
              <DialogDescription>
                Step 1 of 2 — identify the new AY. Copy-forward from the most
                recent AY happens automatically on commit.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onStep1Submit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="ay_code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>AY code</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="AY2027"
                          autoComplete="off"
                          autoCapitalize="characters"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                        />
                      </FormControl>
                      <FormDescription>
                        Format <code className="rounded bg-muted px-1 py-0.5 text-[11px]">AY</code> followed
                        by four digits. Must be unique.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="label"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display label</FormLabel>
                      <FormControl>
                        <Input placeholder="Academic Year 2027" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="accepting_applications"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start gap-3 rounded-lg border border-border bg-muted/20 p-3">
                      <FormControl>
                        <Checkbox
                          checked={!!field.value}
                          onCheckedChange={(v) => field.onChange(Boolean(v))}
                        />
                      </FormControl>
                      <div className="flex-1 space-y-1">
                        <FormLabel className="text-[13px] font-semibold leading-none">
                          Open this AY for early-bird applications now
                        </FormLabel>
                        <FormDescription className="text-[12px] leading-snug">
                          Surfaces in the Admissions sidebar as &quot;Upcoming AY applications&quot; and lets the parent
                          portal submit applications for this AY. Leave off if you&apos;re staging the AY ahead of
                          opening early-bird — you can flip the switch later from the AY list.
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    Next <ArrowRight className="ml-1 size-4" />
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}

        {step === 'review' && (
          <>
            <DialogHeader>
              <DialogTitle>Review — {ayCode}</DialogTitle>
              <DialogDescription>
                Step 2 of 2 — everything below is set up at once.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <ReviewRow
                label="AY row"
                value={
                  preview.ay_already_exists
                    ? `${ayCode} — already exists, will be reused`
                    : `${ayCode} — ${form.getValues('label')}`
                }
              />
              <ReviewRow
                label="Terms"
                value={
                  preview.terms_to_insert === 4
                    ? '4 terms (T1–T4, dates unset)'
                    : preview.terms_to_insert === 0
                      ? '4 already exist — none added'
                      : `${preview.terms_to_insert} added (existing terms preserved)`
                }
              />
              {preview.source_ay_code ? (
                <>
                  <ReviewRow
                    label="Sections"
                    value={
                      preview.sections_to_copy === 0
                        ? 'Already configured — none copied'
                        : `${preview.sections_to_copy} copied from ${formatSource(preview.source_ay_code)}`
                    }
                  />
                  <ReviewRow
                    label="Subject configs"
                    value={
                      preview.subject_configs_to_copy === 0
                        ? 'Already configured — none copied'
                        : `${preview.subject_configs_to_copy} copied from ${formatSource(preview.source_ay_code)}`
                    }
                  />
                </>
              ) : (
                <ReviewRow
                  label="Sections & subject configs"
                  value="None — no template configured and no prior non-test AY to copy from. Seed manually later."
                />
              )}
              <ReviewRow
                label="Admissions tables"
                value={
                  preview.ay_already_exists
                    ? `${aySlug}_enrolment_applications, _status, _documents, _discount_codes — created if missing, existing rows preserved`
                    : `4 created: ${aySlug}_enrolment_applications, _status, _documents, ${aySlug}_discount_codes`
                }
              />
              <ReviewRow
                label="Early-bird"
                value={
                  form.watch('accepting_applications')
                    ? 'Open — appears in Admissions sidebar as "Upcoming AY applications"; parent portal can submit'
                    : 'Closed — applications gated until you flip the switch from the AY list'
                }
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep('identity')} disabled={submitting}>
                <ArrowLeft className="mr-1 size-4" /> Back
              </Button>
              <Button type="button" onClick={onCommit} disabled={submitting}>
                {submitting && <Loader2 className="mr-1 size-4 animate-spin" />}
                Commit
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'follow-up' && createdAyCode && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-brand-mint" />
                {createdAyCode} created
              </DialogTitle>
              <DialogDescription>
                The AY row, 4 terms, sections, subject configs, and 4 admissions
                tables are live. The switcher now shows {createdAyCode} on every
                AY-scoped page.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <p className="text-xs leading-relaxed text-muted-foreground">
                When you&apos;re ready to make {createdAyCode} the live AY (the
                one every module defaults to), use <strong>Switch active</strong>
                on its row. The new AY starts as{' '}
                <code className="rounded bg-muted px-1 py-0.5">is_current=false</code>{' '}
                so nothing changes for existing users until you explicitly flip it.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="text-foreground">{value}</div>
    </div>
  );
}

export function NewAyButton({ preview }: { preview: Preview }) {
  return (
    <AySetupWizard preview={preview}>
      <Button>
        <Plus className="mr-1 size-4" /> New AY
      </Button>
    </AySetupWizard>
  );
}
