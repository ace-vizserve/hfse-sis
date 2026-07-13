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
    label: 'Add a closure',
    sublabel: 'Calendar',
    href: '/sis/calendar',
    icon: CalendarOff,
    toneClass:
      'bg-gradient-to-br from-destructive to-destructive/80 text-white shadow-brand-tile-destructive',
  },
  {
    label: 'New staff member',
    sublabel: 'Staff',
    href: '/sis/admin/staff?view=accounts',
    icon: UserPlus,
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
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5"
    >
      {ACTIONS.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="group flex items-center gap-2.5 rounded-xl border border-border bg-card p-3 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-md"
        >
          <div
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg',
              action.toneClass
            )}
          >
            <action.icon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-semibold text-foreground">
              {action.label}
            </p>
            <p className="truncate text-[10.5px] text-muted-foreground">
              {action.sublabel}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
