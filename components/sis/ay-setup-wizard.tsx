'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Plus,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
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
import { CreateAySchema, type CreateAyInput } from '@/lib/schemas/ay-setup';

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

type CreationSummary = {
  sections_copied: number;
  subject_configs_copied: number;
};

const BLANK: CreateAyInput = {
  ay_code: '',
  label: '',
};

function AySetupWizard({ preview, children }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('identity');
  const [createdAyCode, setCreatedAyCode] = useState<string | null>(null);
  const [creationSummary, setCreationSummary] =
    useState<CreationSummary | null>(null);

  const form = useForm<CreateAyInput>({
    resolver: zodResolver(CreateAySchema),
    defaultValues: BLANK,
  });

  type CreateAyResponse = {
    alreadyExisted?: boolean;
    summary?: {
      ay_existed?: boolean;
      sections_copied?: number;
      subject_configs_copied?: number;
    };
  };

  const createMutation = useMutation({
    mutationFn: (values: CreateAyInput) =>
      apiFetch<CreateAyResponse>('/api/sis/ay-setup', jsonInit('POST', values)),
    onSuccess: (body, values) => {
      if (body.alreadyExisted) {
        toast.info(
          `${values.ay_code} is already fully set up — nothing to do.`
        );
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
      const sectionsCopied: number = body.summary?.sections_copied ?? 0;
      const configsCopied: number = body.summary?.subject_configs_copied ?? 0;
      toast.success(
        ayExisted
          ? `${values.ay_code} setup completed`
          : `${values.ay_code} created`
      );
      // First-AY case: there was no prior AY to copy from (migration 089
      // removed the class-template fallback), so sections and subject
      // configs were not created. Guide the user to set them up manually
      // so they don't wonder why the grading setup is empty.
      if (sectionsCopied === 0 && configsCopied === 0) {
        toast.info(
          'No sections were copied — create sections and attach subjects manually to get started.',
          {
            action: {
              label: 'Open Sections',
              onClick: () => router.push('/sis/sections'),
            },
          }
        );
      }
      setCreatedAyCode(values.ay_code);
      setCreationSummary({
        sections_copied: sectionsCopied,
        subject_configs_copied: configsCopied,
      });
      setStep('follow-up');
      router.refresh();
    },
    onError: (e) => {
      // Preserve the original fallback: `body.error ?? 'Failed to create AY'`.
      const serverError =
        e instanceof ApiError && e.body && typeof e.body === 'object'
          ? (e.body as { error?: string }).error
          : undefined;
      toast.error(serverError ?? 'Failed to create AY');
    },
  });
  const submitting = createMutation.isPending;

  function resetAll() {
    form.reset(BLANK);
    setStep('identity');
    setCreatedAyCode(null);
    setCreationSummary(null);
    createMutation.reset();
  }

  async function onStep1Submit(_values: CreateAyInput) {
    // Step 1 only validates — the actual commit happens on step 2.
    setStep('review');
  }

  function onCommit() {
    createMutation.mutate(form.getValues());
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetAll();
  }

  const ayCode = form.watch('ay_code')?.trim().toUpperCase() || '';
  const aySlug = /^AY\d{4}$/.test(ayCode)
    ? `ay${ayCode.slice(2).toLowerCase()}`
    : 'ay____';

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
              <form
                onSubmit={form.handleSubmit(onStep1Submit)}
                className="space-y-4"
              >
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
                          onChange={(e) =>
                            field.onChange(e.target.value.toUpperCase())
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Format{' '}
                        <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                          AY
                        </code>{' '}
                        followed by four digits. Must be unique.
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
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleOpenChange(false)}
                  >
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
                        : `${preview.sections_to_copy} copied from ${preview.source_ay_code}`
                    }
                  />
                  <ReviewRow
                    label="Subject configs"
                    value={
                      preview.subject_configs_to_copy === 0
                        ? 'Already configured — none copied'
                        : `${preview.subject_configs_to_copy} copied from ${preview.source_ay_code}`
                    }
                  />
                </>
              ) : (
                <ReviewRow
                  label="Sections & subject configs"
                  value="None — no prior non-test AY to copy from. Seed manually later."
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
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep('identity')}
                disabled={submitting}
              >
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
                {creationSummary?.sections_copied === 0 &&
                creationSummary?.subject_configs_copied === 0
                  ? `The AY row, 4 terms, and 4 admissions tables are live. Sections and subject weights still need to be configured.`
                  : `The AY row, 4 terms, sections, subject configs, and 4 admissions tables are live.`}{' '}
                The switcher now shows {createdAyCode} on every AY-scoped page.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              {creationSummary?.sections_copied === 0 &&
                creationSummary?.subject_configs_copied === 0 && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[13px] leading-relaxed text-amber-700 dark:text-amber-400">
                    <strong>Next step:</strong> Open{' '}
                    <button
                      type="button"
                      className="font-semibold underline underline-offset-2 hover:no-underline"
                      onClick={() => {
                        handleOpenChange(false);
                        router.push('/sis/sections');
                      }}
                    >
                      Sections
                    </button>{' '}
                    to create sections for {createdAyCode}, then attach subjects
                    on Subject Weights. Without this step, teachers cannot
                    access grading sheets.
                  </div>
                )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                When you&apos;re ready to make {createdAyCode} the live AY (the
                one every module defaults to), use{' '}
                <strong>Switch active</strong> on its row. The new AY starts
                inactive so nothing changes for existing users until you
                explicitly flip it.
              </p>
            </div>
            <DialogFooter>
              {creationSummary?.sections_copied === 0 &&
              creationSummary?.subject_configs_copied === 0 ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleOpenChange(false)}
                  >
                    Done
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      handleOpenChange(false);
                      router.push('/sis/sections');
                    }}
                  >
                    Open Sections
                  </Button>
                </>
              ) : (
                <Button type="button" onClick={() => handleOpenChange(false)}>
                  Done
                </Button>
              )}
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

export function NewAyButton({
  preview,
  variant = 'default',
}: {
  preview: Preview;
  /**
   * Design system §9.2/§9.5 — exactly one `default` (primary) button per
   * page. On `/sis/ay-setup`, the Year Setup checklist's own next-step CTA
   * is the page's primary (it's the page's actual job — getting the
   * selected AY ready); this header action stays `outline` so the two
   * never compete. Defaults to `default` for other call sites (none
   * currently pass `outline`).
   */
  variant?: 'default' | 'outline';
}) {
  return (
    <AySetupWizard preview={preview}>
      <Button variant={variant}>
        <Plus className="mr-1 size-4" /> New AY
      </Button>
    </AySetupWizard>
  );
}
