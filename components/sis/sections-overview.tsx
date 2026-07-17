'use client';

import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';

import { GenerateAllIndexButton } from '@/components/sis/generate-index-button';
import {
  SectionLevelCard,
  type LevelCardSection,
  type LevelCardTemplateSection,
} from '@/components/sis/section-level-card';
import { Button } from '@/components/ui/button';
import { exportCsv } from '@/components/ui/data-table/csv';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Role } from '@/lib/auth/roles';

export type LevelGroup = {
  levelType: 'primary' | 'secondary' | 'preschool';
  groupLabel: string;
  levels: Array<{
    level: {
      id: string;
      code: string;
      label: string;
      level_type: 'primary' | 'secondary' | 'preschool';
    };
    sections: LevelCardSection[];
    templateSections: LevelCardTemplateSection[];
  }>;
};

const SEGMENT_OPTIONS: Array<{
  value: 'all' | 'primary' | 'secondary' | 'preschool';
  label: string;
}> = [
  { value: 'all', label: 'All' },
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'preschool', label: 'Youngstarters' },
];

// SectionsOverview — the level-card grid + its search/segment filter + CSV
// export. A plain client-side filter over a small, fixed catalog (≤ ~15
// levels) rather than the shared DataTable shell — that shell's
// sort/facet machinery is built for large record lists; a level card's
// "row" is a whole level's worth of sections, which doesn't decompose
// into DataTable's one-row-one-record model. Search matches a level's
// code/label OR any of its sections' names, so typing a section name
// (e.g. "Patience") still finds its card.
export function SectionsOverview({
  groups,
  role,
  termStarted,
  ayId,
  ayCode,
  allSections,
}: {
  groups: LevelGroup[];
  role: Role | null;
  termStarted: boolean;
  ayId: string;
  ayCode: string | null;
  /** Every real section (id/name only) — feeds the bulk "Generate all
   * indexes" action, which fans out per-section regardless of grouping. */
  allSections: Array<{ id: string; name: string }>;
}) {
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<
    'all' | 'primary' | 'secondary' | 'preschool'
  >('all');

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .filter((g) => segment === 'all' || g.levelType === segment)
      .map((g) => ({
        ...g,
        levels: g.levels.filter(({ level, sections }) => {
          if (!q) return true;
          return (
            level.label.toLowerCase().includes(q) ||
            level.code.toLowerCase().includes(q) ||
            sections.some((s) => s.name.toLowerCase().includes(q))
          );
        }),
      }))
      .filter((g) => g.levels.length > 0);
  }, [groups, search, segment]);

  const isRegistrarPlus =
    role === 'registrar' || role === 'school_admin' || role === 'superadmin';

  function handleExport() {
    const rows = groups.flatMap((g) =>
      g.levels.flatMap(({ level, sections }) =>
        sections.length > 0
          ? sections.map((s) => ({
              level,
              section: s as LevelCardSection | null,
            }))
          : [{ level, section: null }]
      )
    );
    exportCsv(
      rows,
      [
        { header: 'Level', accessor: (r) => r.level.label },
        { header: 'Section', accessor: (r) => r.section?.name ?? '' },
        {
          header: 'Track',
          accessor: (r) => r.section?.classType ?? '',
        },
        {
          header: 'Adviser',
          accessor: (r) => r.section?.fcaName ?? '',
        },
        { header: 'Active', accessor: (r) => r.section?.active ?? '' },
        { header: 'Withdrawn', accessor: (r) => r.section?.withdrawn ?? '' },
      ],
      'sis-sections.csv'
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search level or section…"
          className="h-9 max-w-xs"
        />
        <Tabs
          value={segment}
          onValueChange={(v) => setSegment(v as typeof segment)}
        >
          <TabsList variant="segmented" aria-label="Level type">
            {SEGMENT_OPTIONS.map((opt) => (
              <TabsTrigger key={opt.value} value={opt.value}>
                {opt.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-2.5">
          {isRegistrarPlus && allSections.length > 0 && (
            <GenerateAllIndexButton
              sections={allSections}
              termStarted={termStarted}
            />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleExport}
          >
            <Download className="size-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {filteredGroups.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No levels match &ldquo;{search}&rdquo;.
        </p>
      ) : (
        filteredGroups.map((g) => (
          <div key={g.levelType}>
            <div className="mb-2.5 flex items-center gap-2.5">
              <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {g.groupLabel}
              </p>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.levels.map(({ level, sections, templateSections }) => (
                <SectionLevelCard
                  key={level.id}
                  level={level}
                  sections={sections}
                  templateSections={isRegistrarPlus ? templateSections : []}
                  role={role}
                  termStarted={termStarted}
                  ayId={ayId}
                  ayCode={ayCode}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
