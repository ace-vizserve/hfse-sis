'use client';

import { Check, X } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { ActivityEvent, ActivityTone } from '@/lib/activity/events';

/**
 * One approval, end to end.
 *
 * ⚠ THE SPINE BELONGS HERE AND NOT IN THE PANEL. These rows genuinely are one
 * ordered ladder, so a connecting line carries information. In the activity
 * panel, different people's approvals interleave and a line would claim a
 * sequence that is not there.
 *
 * ⚠ OLDEST FIRST, unlike the panel — here you are reading a story rather than
 * checking what is new.
 */

const NODE: Record<ActivityTone, string> = {
  'went-through': 'bg-brand-mint text-ink',
  'turned-down': 'bg-destructive text-destructive-foreground',
  started: 'bg-primary text-primary-foreground',
};

export function ApprovalHistoryDialog({
  trigger,
  title,
  subtitle,
  events,
  footnote,
}: {
  trigger: React.ReactNode;
  title: string;
  subtitle: string;
  events: ActivityEvent[];
  footnote?: string;
}) {
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-[23px] font-semibold tracking-tight">
            {title}
          </DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <ol className="max-h-[60vh] overflow-y-auto pt-2">
          {ordered.map((event, index) => (
            <li key={event.id} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full',
                    NODE[event.tone]
                  )}
                >
                  {event.tone === 'went-through' ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : event.tone === 'turned-down' ? (
                    <X className="size-3.5" aria-hidden />
                  ) : null}
                </span>
                {index < ordered.length - 1 && (
                  <span className="my-1 w-0.5 flex-1 bg-border" aria-hidden />
                )}
              </div>

              <div className="min-w-0 flex-1 pb-7">
                <p className="text-[15px] leading-normal text-ink-3">
                  <b className="font-semibold text-foreground">
                    {event.actorLabel}
                  </b>{' '}
                  {event.predicate}
                </p>
                <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider tabular-nums text-ink-5">
                  {absoluteTime(event.at)}
                </p>
                {event.details?.map((detail, i) => (
                  <p
                    key={`${event.id}-d-${i}`}
                    className="mt-2.5 rounded-xl border border-brand-indigo-soft/30 bg-accent px-4 py-3 text-[14px] leading-normal text-ink-2"
                  >
                    {detail.kind === 'note' ? `“${detail.text}”` : detail.text}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ol>

        {footnote && (
          <p className="border-t border-border pt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-5">
            {footnote}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-SG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
