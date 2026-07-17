'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Layers, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { AdviserCell } from '@/components/sections/adviser-cell';
import { SectionRowActions } from '@/components/sections/section-row-actions';
import { NewSectionButton } from '@/components/markbook/new-section-button';
import { GenerateIndexButton } from '@/components/sis/generate-index-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { StatusBadge } from '@/components/ui/status-badge';
import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
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
// Adding is smarter too: Structure Defaults already knows a level's
// official section names (the virtue sections, KD #144) — an empty or
// partly-filled level offers a one-click "Create N (template)" for
// whichever names are still missing, alongside the manual fallback.

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

export type LevelCardTemplateSection = {
  name: string;
  classType: SectionClassType | null;
};

export function SectionLevelCard({
  level,
  sections,
  templateSections,
  role,
  termStarted,
  ayId,
  ayCode,
}: {
  level: {
    id: string;
    code: string;
    label: string;
    level_type: 'primary' | 'secondary' | 'preschool';
  };
  sections: LevelCardSection[];
  /** This level's official section names per Structure Defaults — empty
   * for levels with no template entry yet (e.g. Youngstarters, KD #144). */
  templateSections: LevelCardTemplateSection[];
  role: Role | null;
  termStarted: boolean;
  ayId: string;
  ayCode: string | null;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);

  const existingNamesLower = new Set(
    sections.map((s) => s.name.trim().toLowerCase())
  );
  const missingTemplateSections = templateSections.filter(
    (t) => !existingNamesLower.has(t.name.trim().toLowerCase())
  );

  const batchCreateMutation = useMutation({
    mutationFn: async () => {
      let created = 0;
      const errors: string[] = [];
      for (const t of missingTemplateSections) {
        try {
          await apiFetch(
            '/api/sections',
            jsonInit('POST', {
              name: t.name,
              level_id: level.id,
              class_type: t.classType,
            })
          );
          created++;
        } catch (e) {
          const detail =
            e instanceof ApiError && e.body && typeof e.body === 'object'
              ? (e.body as { error?: string }).error
              : undefined;
          errors.push(`${t.name}: ${detail ?? 'failed'}`);
        }
      }
      return { created, errors };
    },
    onSuccess: ({ created, errors }) => {
      if (created > 0) {
        toast.success(
          `Created ${created} section${created === 1 ? '' : 's'} for ${level.label}`
        );
        router.refresh();
      }
      if (errors.length > 0) {
        toast.error(
          `${errors.length} section${errors.length === 1 ? '' : 's'} failed`,
          { description: errors.join('\n') }
        );
      }
    },
    onError: () => {
      toast.error(`Could not create sections for ${level.label}`);
    },
  });

  const isRegistrarPlus =
    role === 'registrar' || role === 'school_admin' || role === 'superadmin';

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
            <>
              {templateSections.length > 0 && (
                <div className="space-y-2 rounded-xl border border-dashed border-hairline-strong bg-muted/40 p-2.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                    <Layers className="size-3 shrink-0" />
                    Structure Defaults has {templateSections.length}
                  </p>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {templateSections.map((t) => t.name).join(', ')}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 w-full gap-1.5 text-xs"
                    disabled={batchCreateMutation.isPending}
                    onClick={() => batchCreateMutation.mutate()}
                  >
                    {batchCreateMutation.isPending && (
                      <Loader2 className="size-3 animate-spin" />
                    )}
                    <Plus className="size-3" />
                    Create all {templateSections.length}
                  </Button>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 border-dashed text-xs text-muted-foreground"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="size-3" />
                {templateSections.length > 0
                  ? 'or add one manually'
                  : 'Add section'}
              </Button>
            </>
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
          {isRegistrarPlus && missingTemplateSections.length > 0 && (
            <div className="border-t border-dashed border-hairline-strong p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full gap-1.5 text-xs text-primary hover:text-primary"
                disabled={batchCreateMutation.isPending}
                onClick={() => batchCreateMutation.mutate()}
              >
                {batchCreateMutation.isPending && (
                  <Loader2 className="size-3 animate-spin" />
                )}
                <Plus className="size-3" />
                Add missing {missingTemplateSections.length} (template)
              </Button>
            </div>
          )}
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
