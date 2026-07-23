// components/sis/hub-module-overview.tsx
//
// Presentational per-module "at a glance" row for the SIS Admin hub. Renders
// one live KPI card per operational module, fed by `getHubModuleOverview`
// (lib/sis/hub-module-overview.ts). Purely presentational — no client state,
// no interactivity beyond the Link.
import Link from 'next/link';
import {
  FileText,
  Users,
  CheckCircle2,
  BookOpen,
  MessageSquare,
  FileWarning,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { HubModuleOverviewRow } from '@/lib/sis/hub-module-overview';

const ICON_BY_KEY: Record<string, LucideIcon> = {
  admissions: FileText,
  records: Users,
  attendance: CheckCircle2,
  markbook: BookOpen,
  evaluation: MessageSquare,
  'p-files': FileWarning,
};

const TONE_CLASS: Record<HubModuleOverviewRow['tone'], string> = {
  indigo:
    'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile',
  amber:
    'bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber',
};

export function HubModuleOverview({ rows }: { rows: HubModuleOverviewRow[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {rows.map((row) => {
        const Icon = ICON_BY_KEY[row.key] ?? FileText;
        return (
          <Link
            key={row.key}
            href={row.href}
            className="group flex flex-col gap-2.5 rounded-xl border border-border bg-gradient-to-b from-card to-muted/20 p-3.5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <div
              className={cn(
                'flex size-8 items-center justify-center rounded-lg',
                TONE_CLASS[row.tone]
              )}
            >
              <Icon className="size-3.5" />
            </div>
            <div>
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {row.label}
              </p>
              <p className="mt-0.5 font-serif text-xl font-semibold tabular-nums text-foreground">
                {row.value}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
