'use client';

import { ArrowLeft, ArrowRight, CheckCircle2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';

import { useWriteAction } from '@/lib/hooks/use-write-action';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ayIdentityForYear } from '@/lib/schemas/ay-setup';

type Props = {
  /** `ay_code`s that already exist — those years are not offered. */
  existingAyCodes: string[];
  children: ReactNode;
};

type Step = 'identity' | 'review' | 'follow-up';

type CreateAyResponse = { ok?: boolean };

/** Years that can still be created: last year through five years ahead. */
function availableYears(existingAyCodes: string[], now = new Date()): number[] {
  const thisYear = now.getFullYear();
  const taken = new Set(existingAyCodes);
  const years: number[] = [];
  for (let y = thisYear - 1; y <= thisYear + 5; y++) {
    if (!taken.has(ayIdentityForYear(y).ay_code)) years.push(y);
  }
  return years;
}

function AySetupWizard({ existingAyCodes, children }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('identity');
  const [year, setYear] = useState<number | null>(null);
  const [createdAyCode, setCreatedAyCode] = useState<string | null>(null);

  const years = availableYears(existingAyCodes);

  const createMutation = useMutation({
    mutationFn: (y: number) =>
      apiFetch<CreateAyResponse>(
        '/api/sis/ay-setup',
        jsonInit('POST', { year: y })
      ),
  });

  const run = useWriteAction();
  const [submitting, setSubmitting] = useState(false);

  function resetAll() {
    setYear(null);
    setStep('identity');
    setCreatedAyCode(null);
    createMutation.reset();
  }

  async function onCommit() {
    if (year === null) return;
    const { ay_code: code } = ayIdentityForYear(year);
    setSubmitting(true);
    await run(() => createMutation.mutateAsync(year), {
      pending: `Setting up ${code}…`,
      success: () => `${code} created`,
      error: (e: unknown) => {
        const serverError =
          e instanceof ApiError && e.body && typeof e.body === 'object'
            ? (e.body as { error?: string }).error
            : undefined;
        return serverError ?? 'Failed to create AY';
      },
      onResolved: () => {
        setCreatedAyCode(code);
        setStep('follow-up');
      },
    });
    setSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetAll();
  }

  const identity = year === null ? null : ayIdentityForYear(year);
  const ayCode = identity?.ay_code ?? '';
  const aySlug = `ay${year ?? '____'}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {step === 'identity' && (
          <>
            <DialogHeader>
              <DialogTitle>Create a new academic year</DialogTitle>
              <DialogDescription>
                Step 1 of 2 — pick the year. HFSE&apos;s standard starting
                catalog is set up automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {years.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Every year from last year to five years ahead already has an
                  academic year, so there is nothing new to create.
                </p>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="new-ay-year">Year</Label>
                  <Select
                    value={year === null ? '' : String(year)}
                    onValueChange={(v) => setYear(Number(v))}
                  >
                    <SelectTrigger id="new-ay-year" className="w-full">
                      <SelectValue placeholder="Choose a year" />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Only years that do not already exist are listed.
                  </p>
                </div>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={year === null}
                  onClick={() => setStep('review')}
                >
                  Next <ArrowRight className="ml-1 size-4" />
                </Button>
              </DialogFooter>
            </div>
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
              <ReviewRow label="Code" value={ayCode} />
              <ReviewRow label="Name" value={identity?.label ?? ''} />
              <ReviewRow label="Terms" value="4 terms (T1–T4, dates unset)" />
              <ReviewRow
                label="Sections & subjects"
                value="HFSE's standard starting catalog will be created — sections, subjects, and weights, ready to edit"
              />
              <ReviewRow
                label="Admissions tables"
                value={`4 created: ${aySlug}_enrolment_applications, _status, _documents, ${aySlug}_discount_codes`}
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
              <Button
                type="button"
                onClick={() => void onCommit()}
                loading={submitting}
                loadingText="Setting up…"
              >
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
                The AY row, terms, sections, subject configs, and 4 admissions
                tables are all live — HFSE&apos;s standard starting catalog,
                ready to edit. The switcher now shows {createdAyCode} on every
                AY-scoped page.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <p className="text-xs leading-relaxed text-muted-foreground">
                When you&apos;re ready to make {createdAyCode} the live AY (the
                one every module defaults to), use{' '}
                <strong>Switch active</strong> on its row. The new AY starts
                inactive so nothing changes for existing users until you
                explicitly flip it.
              </p>
            </div>
            <DialogFooter>
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
  existingAyCodes,
  variant = 'default',
}: {
  existingAyCodes: string[];
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
    <AySetupWizard existingAyCodes={existingAyCodes}>
      <Button variant={variant}>
        <Plus className="mr-1 size-4" /> New AY
      </Button>
    </AySetupWizard>
  );
}
