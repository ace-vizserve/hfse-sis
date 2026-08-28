'use client';

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type {
  ActivityEvent,
  ActivityFlow,
  ActivityTone,
} from '@/lib/activity/events';

/**
 * One row of the activity log.
 *
 * ⚠ THE ONLY PLACE COLOUR IS SPENT, and it is spent on the small mark at the
 * corner of the avatar, in the three §9.3 tones. The avatar itself keeps the
 * standard gradient tile so a long log stays scannable without turning into a
 * fruit salad. Do not colour the circle by flow.
 */

/**
 * ⚠ CRAFTED, NEVER FLAT (§7.4). A solid disc of colour is the one thing this
 * design system says an icon tile must not be — the house voice is a diagonal
 * gradient closing on a darker stop, with the matching tile shadow. These are
 * the same three recipes `components/attendance/daily-entry.tsx` uses, so a
 * mint mark means the same thing and looks the same in both places.
 */
const TONE_DOT: Record<ActivityTone, string> = {
  'went-through':
    'bg-gradient-to-br from-brand-mint to-brand-sky text-ink shadow-brand-tile-mint',
  'turned-down':
    'bg-gradient-to-br from-destructive to-destructive/80 text-white shadow-brand-tile-destructive',
  started:
    'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile',
};

/**
 * Which flow a row came from, said in the words the tabs use.
 *
 * ⚠ THE HUES ARE CHOSEN TO BE UNMISTAKABLE FOR STATUS, and that constraint is
 * the whole reason these two and not any others. A row already carries colour
 * that MEANS something: the mark on the avatar is mint / destructive / primary
 * for approved / turned down / newly filed (§9.3). A flow chip in any of those
 * three would read as an outcome — a mint "Declaration" says approved before
 * the reader has processed the word.
 *
 * So flow uses the two Aurora Vault hues that carry no status meaning
 * anywhere in this product, sky and amber, in the §9.3 recipe shape (tinted
 * wash + matching border) with the text left at high-contrast ink so a 10px
 * uppercase label stays legible. Colour still carries meaning here — it is
 * just answering "what kind of thing is this", not "how did it go".
 */
const FLOW_STYLE: Record<ActivityFlow, string> = {
  grade_change: 'from-brand-amber to-brand-amber/80',
  student_declaration: 'from-chart-4 to-chart-2',
};

const FLOW_LABEL: Record<ActivityFlow, string> = {
  grade_change: 'Mark change',
  student_declaration: 'Declaration',
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
          <span className="flex flex-wrap items-center gap-2">
            <Badge
              className={cn(
                'h-5 px-1.5 text-[10px] tracking-wider',
                FLOW_STYLE[event.flow]
              )}
            >
              {FLOW_LABEL[event.flow]}
            </Badge>
            <span className="font-mono text-[10px] uppercase tracking-wider tabular-nums text-ink-5">
              {relativeTime(event.at)}
            </span>
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
