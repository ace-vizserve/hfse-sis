import Link from 'next/link';
import { Layers } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type SectionsByLevelRow = {
  id: string;
  code: string;
  label: string;
  isCore: boolean;
  sortOrder: number;
};

export type SectionChip = {
  id: string;
  name: string;
  active: number;
};

/**
 * SectionsByLevelTree — how many sections exist under each level, in
 * catalog order. Reuses the same dot-and-line connector language as Grade
 * Levels' hierarchy view (components/sis/levels-manager-client.tsx) for
 * visual consistency across the module, but simpler: level -> sections is
 * a direct, unambiguous FK relationship (no evidence/fallback split like
 * level -> level progression needed), so every level renders as a single
 * spine — no branch/evidenced distinction to encode here.
 */
export function SectionsByLevelTree({
  levels,
  sectionsByLevelId,
}: {
  levels: SectionsByLevelRow[];
  sectionsByLevelId: Map<string, SectionChip[]>;
}) {
  const sorted = [...levels].sort((a, b) => a.sortOrder - b.sortOrder);

  if (sorted.length === 0) return null;

  return (
    <Card className="@container/card gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-4">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <Layers className="size-4" />
        </div>
        <div className="leading-tight">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Sections by level
          </p>
          <p className="font-serif text-[16px] font-semibold text-foreground">
            {sorted.length} levels in the catalog
          </p>
        </div>
      </div>
      <div role="tree">
        {sorted.map((level, i) => {
          const sections = sectionsByLevelId.get(level.id) ?? [];
          return (
            <div
              key={level.id}
              className="flex items-stretch border-b border-border last:border-b-0"
              role="treeitem"
            >
              <div className="flex w-8 shrink-0 flex-col items-center">
                <div
                  className={cn(
                    'w-px flex-1 bg-border',
                    i === 0 && 'invisible'
                  )}
                  aria-hidden
                />
                <div
                  className="size-2.5 shrink-0 rounded-full bg-brand-indigo ring-4 ring-card"
                  aria-hidden
                />
                <div
                  className={cn(
                    'w-px flex-1 bg-border',
                    i === sorted.length - 1 && 'invisible'
                  )}
                  aria-hidden
                />
              </div>
              <div className="flex-1 py-3 pr-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="h-6 border-border bg-card px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
                  >
                    {level.code}
                  </Badge>
                  <span className="font-serif text-[14px] font-semibold text-foreground">
                    {level.label}
                  </span>
                  {level.isCore && <Badge variant="muted">Core</Badge>}
                  <Badge
                    variant={sections.length === 0 ? 'warning' : 'outline'}
                    className="ml-auto gap-1 font-normal"
                  >
                    {sections.length} section{sections.length === 1 ? '' : 's'}
                  </Badge>
                </div>
                {sections.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-1">
                    {sections.map((s) => (
                      <Link
                        key={s.id}
                        href={`/sis/sections/${s.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground transition-colors hover:border-brand-indigo/40 hover:bg-accent/40"
                      >
                        {s.name}
                        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                          {s.active}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
