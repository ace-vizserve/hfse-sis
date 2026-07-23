'use client';

import { CheckCircle2, Plus } from 'lucide-react';
import { useState } from 'react';

import { NewSectionButton } from '@/components/markbook/new-section-button';
import { AdviserCell } from '@/components/sections/adviser-cell';
import { SectionRowActions } from '@/components/sections/section-row-actions';
import { GenerateIndexButton } from '@/components/sis/generate-index-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { StatusBadge } from '@/components/ui/status-badge';
import type { Role } from '@/lib/auth/roles';
import {
  SCHEDULE_LABELS,
  type Schedule,
  type SectionClassType,
} from '@/lib/schemas/section';
import type { IndexStatus } from '@/lib/sis/section-index-status';

// SectionLevelCard — one card per grade level (the "Sections & advisers"
// page rebuild). The page's purpose is really "does every offered level
// have its section(s) set up, staffed, numbered" — a per-LEVEL readiness
// check — but the prior design was a per-SECTION table, so any level
// without a section yet had to render as a full dash-filled row just to
// say "nothing here." A card per level fixes that at the root: an empty
// level is one compact card, a populated level lists its real sections
// inline, and "add another" is always right there (previously, adding a
// 2nd/3rd section to an already-populated level meant leaving the row for
// the generic top-right button).
//
// A template-driven "create all N official section names in one click"
// quick-add used to live here (KD #144) — removed alongside the Structure
// Defaults template (migration 089): there's no more master list of
// official section names independent of an AY to offer it from. Adding is
// manual only now, via the "Add section" button.

export type LevelCardSection = {
  id: string;
  name: string;
  schedule: Schedule | null;
  classType: SectionClassType | null;
  active: number;
  withdrawn: number;
  indexStatus: IndexStatus | null;
  fcaName: string | null;
};

export function SectionLevelCard({
  level,
  sections,
  role,
  termStarted,
  ayId,
  ayCode,
}: {
  level: {
    id: string;
    code: string;
    label: string;
    level_type: 'primary' | 'secondary';
  };
  sections: LevelCardSection[];
  role: Role | null;
  termStarted: boolean;
  ayId: string;
  ayCode: string | null;
}) {
  const [addOpen, setAddOpen] = useState(false);

  const isRegistrarPlus =
    role === 'academic_coordinator' ||
    role === 'school_admin' ||
    role === 'superadmin';

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <div className="min-w-0 leading-tight">
          <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {level.code}
          </p>
          <p className="truncate font-serif text-[14.5px] font-semibold text-foreground">
            {level.label}
          </p>
        </div>
        {sections.length > 0 && isRegistrarPlus && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setAddOpen(true)}
            aria-label={`Add another section to ${level.label}`}
            title={`Add another section to ${level.label}`}
          >
            <Plus className="size-3.5" />
          </Button>
        )}
      </div>

      {sections.length === 0 ? (
        <div className="flex flex-1 flex-col gap-3 p-3.5">
          <p className="text-xs text-muted-foreground">No section yet.</p>
          {isRegistrarPlus && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 border-dashed text-xs text-muted-foreground"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="size-3" />
              Add section
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-col divide-y divide-border">
            {sections.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 px-3.5 py-2 text-[13px]"
              >
                <IdentifierLink
                  href={`/sis/sections/${s.id}`}
                  className="min-w-0 flex-1 truncate font-serif text-[13.5px] font-semibold"
                >
                  {s.name}
                </IdentifierLink>
                {s.classType && (
                  <Badge
                    variant="outline"
                    className="h-5 shrink-0 border-border bg-card px-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-foreground"
                    title={s.classType}
                  >
                    {s.classType[0]}
                  </Badge>
                )}
                {s.schedule && (
                  <Badge
                    variant="outline"
                    className="hidden h-5 shrink-0 border-border bg-card px-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-foreground sm:inline-flex"
                  >
                    {SCHEDULE_LABELS[s.schedule]}
                  </Badge>
                )}
                <div className="hidden shrink-0 xl:block">
                  <AdviserCell name={s.fcaName} showAvatar flagMissing />
                </div>
                {s.indexStatus && (
                  <span className="hidden shrink-0 items-center gap-1 xl:flex">
                    {s.indexStatus.tone === 'mint' ? (
                      <StatusBadge tone="healthy" icon={CheckCircle2}>
                        {s.active}
                      </StatusBadge>
                    ) : (
                      <GenerateIndexButton
                        sectionId={s.id}
                        sectionName={s.name}
                        termStarted={termStarted}
                        variant="compact"
                      />
                    )}
                  </span>
                )}
                <SectionRowActions
                  module="sis"
                  sectionId={s.id}
                  sectionName={s.name}
                  role={role}
                  termStarted={termStarted}
                  hasAdviser={!!s.fcaName}
                  ayId={ayId}
                  levelType={level.level_type}
                  classType={s.classType}
                />
              </div>
            ))}
          </div>
        </>
      )}

      <NewSectionButton
        levels={[level]}
        ayCode={ayCode}
        open={addOpen}
        onOpenChange={setAddOpen}
        initialLevelId={level.id}
      />
    </div>
  );
}
