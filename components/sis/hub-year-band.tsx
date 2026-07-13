import Link from 'next/link';
import { ArrowRight, CalendarCog, CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  READINESS_SEGMENT_CLASS,
  describeYearBandStatus,
  type AyReadiness,
} from '@/lib/sis/readiness';

/**
 * HubYearBand — the SIS Admin hub's signature element (Task V1 of the
 * visual redesign, `docs/superpowers/specs/2026-07-11-sis-admin-visual-redesign.html`
 * Screen 1). Replaces `HubYearSetupCard`: one horizontal readiness card —
 * serif fraction, segmented bar, a live plain-English status line, and the
 * page's ONE primary CTA. The band itself carries no icon tile (matches the
 * approved mockup); the empty-state tile below stays flat `bg-muted` — the
 * neutral "nothing set up yet" absence state, not a semantic color (see
 * `components/sis/hub-stat.tsx` and the visual-consistency pass,
 * `docs/superpowers/specs/2026-07-13-sis-admin-visual-consistency-mockups.html`,
 * which reversed the earlier "no gradients on content" rule everywhere else).
 */
export function HubYearBand({ readiness }: { readiness: AyReadiness | null }) {
  if (!readiness || readiness.total === 0) {
    return (
      <Card
        role="group"
        aria-label="Year setup readiness"
        className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <CalendarCog className="size-5" />
          </div>
          <div className="space-y-0.5">
            <p className="text-[14px] font-medium text-foreground">
              No academic year set up yet
            </p>
            <p className="text-[13px] text-muted-foreground">
              Create one to start setup.
            </p>
          </div>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href="/sis/ay-setup">
            Start setup <ArrowRight className="size-4" />
          </Link>
        </Button>
      </Card>
    );
  }

  const { complete, total, steps } = readiness;
  const allDone = complete === total;
  const requiredSteps = steps.filter((s) => s.required);
  const { headline, detail } = describeYearBandStatus(readiness);

  return (
    <Card
      role="group"
      aria-label="Year setup readiness"
      className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6"
    >
      <div className="flex shrink-0 items-baseline gap-1.5">
        <span className="font-serif text-[30px] font-semibold leading-none tabular-nums text-foreground">
          {complete}
        </span>
        <span className="text-[14px] font-medium text-muted-foreground">
          / {total} ready
        </span>
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-[13px] leading-snug">
          <span className="font-medium text-foreground">{headline}</span>{' '}
          <span className="text-muted-foreground">{detail}</span>
        </p>
        {/* Decorative — the sentence above already states the same
            complete/total status in accessible text. */}
        <div className="flex gap-1" aria-hidden="true">
          {requiredSteps.map((step) => (
            <span
              key={step.id}
              className={cn(
                'h-2 flex-1 rounded-full',
                READINESS_SEGMENT_CLASS[step.status]
              )}
            />
          ))}
        </div>
      </div>

      <Button
        asChild
        size="sm"
        variant={allDone ? 'outline' : 'default'}
        className="shrink-0"
      >
        <Link href="/sis/ay-setup">
          {allDone ? (
            <>
              <CheckCircle2 className="size-4" /> Year setup complete
            </>
          ) : (
            <>
              Finish setup <ArrowRight className="size-4" />
            </>
          )}
        </Link>
      </Button>
    </Card>
  );
}
