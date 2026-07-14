import Link from 'next/link';
import {
  CalendarOff,
  ClipboardList,
  Layers,
  LayoutGrid,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * HubQuickActions — the SIS Admin hub's five-tile launchpad row (Task V1,
 * `docs/superpowers/specs/2026-07-11-sis-admin-visual-redesign.html` Screen
 * 1). Gradient icon tiles per the app's real signature (visual-consistency
 * pass — the earlier "no gradients on content" rule was reversed, see
 * `components/sis/hub-stat.tsx`) — hover lift per §7.3. "New section" and
 * "New staff member" share the one neutral indigo/navy tile (no precedent
 * anywhere in this app for varying a tile's hue across non-semantic
 * actions); "Add a closure"/"Generate sheets"/"Grade levels" keep their
 * semantic destructive/mint/amber tones.
 *
 * Order is frequency-weighted, not arbitrary (layout redesign pass, Pareto
 * Principle) — "New section"/"Generate sheets"/"New staff member" are the
 * recurring "This year"-cadence actions (KD #154's sidebar cadence hints);
 * "Add a closure" is occasional; "Grade levels" is once-a-year Structure
 * config, so it sits last.
 */

type QuickAction = {
  label: string;
  sublabel: string;
  href: string;
  icon: LucideIcon;
  toneClass: string;
};

const NEUTRAL_TILE =
  'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile';

const ACTIONS: QuickAction[] = [
  {
    label: 'New section',
    sublabel: 'Sections',
    href: '/sis/sections',
    icon: LayoutGrid,
    toneClass: NEUTRAL_TILE,
  },
  {
    label: 'Generate sheets',
    sublabel: 'Grading',
    href: '/markbook/sections',
    icon: ClipboardList,
    toneClass:
      'bg-gradient-to-br from-brand-mint to-brand-sky text-ink shadow-brand-tile-mint',
  },
  {
    label: 'New staff member',
    sublabel: 'Staff',
    href: '/sis/admin/staff?view=accounts',
    icon: UserPlus,
    toneClass: NEUTRAL_TILE,
  },
  {
    label: 'Add a closure',
    sublabel: 'Calendar',
    href: '/sis/calendar',
    icon: CalendarOff,
    toneClass:
      'bg-gradient-to-br from-destructive to-destructive/80 text-white shadow-brand-tile-destructive',
  },
  {
    label: 'Grade levels',
    sublabel: 'Structure',
    href: '/sis/admin/levels',
    icon: Layers,
    toneClass:
      'bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber',
  },
];

export function HubQuickActions() {
  return (
    <div
      role="group"
      aria-label="Quick actions"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
    >
      {ACTIONS.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="group flex items-center gap-3 rounded-xl border border-border bg-gradient-to-b from-card to-muted/20 p-3.5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-md"
        >
          <div
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-xl',
              action.toneClass
            )}
          >
            <action.icon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-foreground">
              {action.label}
            </p>
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {action.sublabel}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
