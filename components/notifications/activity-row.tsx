'use client';

import Link from 'next/link';

import { cn } from '@/lib/utils';
import type { ActivityEvent, ActivityTone } from '@/lib/activity/events';

/**
 * One row of the activity log.
 *
 * ⚠ THE ONLY PLACE COLOUR IS SPENT, and it is spent on the small mark at the
 * corner of the avatar, in the three §9.3 tones. The avatar itself keeps the
 * standard gradient tile so a long log stays scannable without turning into a
 * fruit salad. Do not colour the circle by flow.
 */

const TONE_DOT: Record<ActivityTone, string> = {
  'went-through': 'bg-brand-mint text-ink',
  'turned-down': 'bg-destructive text-destructive-foreground',
  started: 'bg-primary text-primary-foreground',
};

export function ActivityRow({
  event,
  onNavigate,
}: {
  event: ActivityEvent;
  onNavigate?: () => void;
}) {
  return (
    <li className="border-b border-border last:border-0">
      <Link
        href={event.href}
        onClick={onNavigate}
        className="flex gap-4 px-6 py-5 transition-colors hover:bg-accent"
      >
        <span className="relative size-11 shrink-0">
          <span className="flex size-11 items-center justify-center rounded-full bg-gradient-to-br from-brand-indigo to-brand-navy text-[13px] font-semibold text-white shadow-brand-tile">
            {event.actorInitials}
          </span>
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 size-[18px] rounded-full border-[2.5px] border-card',
              TONE_DOT[event.tone]
            )}
            aria-hidden
          />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="text-[15px] leading-normal text-ink-3">
            <b className="font-semibold text-foreground">{event.actorLabel}</b>{' '}
            {event.predicate}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider tabular-nums text-ink-5">
            {relativeTime(event.at)}
          </span>
          {event.details?.map((detail, i) => (
            <span
              key={`${event.id}-detail-${i}`}
              className="mt-0.5 rounded-xl border border-brand-indigo-soft/30 bg-accent px-4 py-3 text-[14px] leading-normal text-ink-2"
            >
              {detail.kind === 'note' ? `“${detail.text}”` : detail.text}
            </span>
          ))}
        </span>
      </Link>
    </li>
  );
}

/**
 * ⚠ Never throws and never returns an empty string. This renders inside the
 * app header; an exception costs the whole page, not one timestamp.
 */
export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'Earlier';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
