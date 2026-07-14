'use client';

import { useState } from 'react';
import { LayoutGrid, Plus } from 'lucide-react';

import { NewSectionButton } from '@/components/markbook/new-section-button';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type LevelOption = { id: string; code: string; label: string };

/**
 * SectionsNeededPanel — surfaces levels that are OFFERED this AY (core, or
 * volatile with an ay_level_offerings row) but have zero sections yet.
 * Unlike a shelved level (deliberately not running), an offered level with
 * no section is a real gap: nobody can be enrolled there this year even
 * though it's meant to be available. Same "one-click, pre-filled dialog"
 * pattern as Grade Levels' Smart Sync panel (components/sis/levels-
 * manager-client.tsx) — clicking "Add section" opens the same New Section
 * dialog used everywhere else, pre-selected to that level, not a
 * duplicate/simplified creation path.
 */
export function SectionsNeededPanel({
  levels,
  ayCode,
}: {
  levels: LevelOption[];
  ayCode: string | null;
}) {
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);

  if (levels.length === 0) return null;

  return (
    <Card className="@container/card gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-3 border-b border-border bg-brand-amber/5 px-5 py-4">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber">
          <LayoutGrid className="size-4" />
        </div>
        <div className="leading-tight">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Sections needed
          </p>
          <p className="font-serif text-[16px] font-semibold text-foreground">
            {levels.length} offered level{levels.length === 1 ? '' : 's'} with
            no section yet
          </p>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {levels.map((level) => (
          <li
            key={level.id}
            className="flex items-center justify-between gap-3 px-5 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                <span className="font-mono text-xs text-muted-foreground">
                  {level.code}
                </span>{' '}
                {level.label}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Offered{ayCode ? ` in ${ayCode}` : ''} — nobody can be enrolled
                here yet
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => setSelectedLevelId(level.id)}
            >
              <Plus className="size-3.5" />
              Add section
            </Button>
          </li>
        ))}
      </ul>

      <NewSectionButton
        levels={levels}
        ayCode={ayCode}
        open={selectedLevelId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedLevelId(null);
        }}
        initialLevelId={selectedLevelId ?? undefined}
      />
    </Card>
  );
}
