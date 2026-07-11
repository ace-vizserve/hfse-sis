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
 * 1). Plain link-tiles, no icon-tile gradients (solid tints per the
 * standing no-gradients-on-content rule) — hover lift per §7.3.
 */

type QuickAction = {
  label: string;
  sublabel: string;
  href: string;
  icon: LucideIcon;
  toneClass: string;
};

const ACTIONS: QuickAction[] = [
  {
    label: 'New section',
    sublabel: 'Sections',
    href: '/sis/sections',
    icon: LayoutGrid,
    toneClass: 'bg-brand-indigo/10 text-brand-indigo',
  },
  {
    label: 'Add a closure',
    sublabel: 'Calendar',
    href: '/sis/calendar',
    icon: CalendarOff,
    toneClass: 'bg-destructive/10 text-destructive',
  },
  {
    label: 'New staff member',
    sublabel: 'Staff',
    href: '/sis/admin/staff?view=accounts',
    icon: UserPlus,
    toneClass: 'bg-brand-sky/15 text-brand-sky',
  },
  {
    label: 'Generate sheets',
    sublabel: 'Grading',
    href: '/markbook/sections',
    icon: ClipboardList,
    toneClass: 'bg-brand-mint/25 text-ink',
  },
  {
    label: 'Grade levels',
    sublabel: 'Structure',
    href: '/sis/admin/levels',
    icon: Layers,
    toneClass: 'bg-brand-amber/25 text-ink',
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
