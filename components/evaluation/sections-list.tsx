'use client';

import { CheckCircle2, SquarePen } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export type SectionCardData = {
  id: string;
  name: string;
  levelId: string | null;
  levelLabel: string | null;
  active: number;
  submitted: number;
};

export type LevelOption = { id: string; code: string; label: string };

export function EvaluationSectionsList({
  sections,
  levels,
  selectedTermId,
}: {
  sections: SectionCardData[];
  levels: LevelOption[];
  selectedTermId: string;
}) {
  const [activeLevelId, setActiveLevelId] = useState<string | null>(null);

  // When a level is active, show a flat filtered list.
  // When showing all, group by level so the structure is clear.
  const groups = useMemo(() => {
    const source = activeLevelId
      ? sections.filter((s) => s.levelId === activeLevelId)
      : sections;

    if (activeLevelId) {
      return [
        {
          levelId: activeLevelId,
          levelLabel: levels.find((l) => l.id === activeLevelId)?.label ?? null,
          sections: source,
        },
      ];
    }

    const map = new Map<
      string,
      { levelLabel: string | null; sections: SectionCardData[] }
    >();
    for (const s of source) {
      const key = s.levelId ?? '__none__';
      if (!map.has(key))
        map.set(key, { levelLabel: s.levelLabel, sections: [] });
      map.get(key)!.sections.push(s);
    }
    return Array.from(map.entries()).map(([levelId, g]) => ({ levelId, ...g }));
  }, [sections, levels, activeLevelId]);

  return (
    <div className="space-y-6">
      {levels.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <FilterChip
            active={activeLevelId === null}
            onClick={() => setActiveLevelId(null)}
          >
            All
          </FilterChip>
          {levels.map((l) => (
            <FilterChip
              key={l.id}
              active={activeLevelId === l.id}
              onClick={() =>
                setActiveLevelId(activeLevelId === l.id ? null : l.id)
              }
            >
              {l.code}
            </FilterChip>
          ))}
        </div>
      )}

      {groups.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No sections for this level.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.levelId ?? 'none'} className="space-y-3">
              <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {group.levelLabel ?? 'Unknown level'}
                <span className="ml-2 text-muted-foreground/50">
                  {group.sections.length}{' '}
                  {group.sections.length === 1 ? 'section' : 'sections'}
                </span>
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {group.sections.map((s) => (
                  <SectionCard
                    key={s.id}
                    section={s}
                    selectedTermId={selectedTermId}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionCard({
  section: s,
  selectedTermId,
}: {
  section: SectionCardData;
  selectedTermId: string;
}) {
  const complete = s.active > 0 && s.submitted === s.active;
  const started = s.submitted > 0;
  const percent =
    s.active === 0 ? 0 : Math.round((s.submitted / s.active) * 100);

  return (
    <Link
      href={`/evaluation/sections/${s.id}?term_id=${selectedTermId}`}
      className="group"
    >
      <Card className="@container/card h-full gap-3 transition-all group-hover:-translate-y-0.5 group-hover:border-brand-indigo/40 group-hover:shadow-sm">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {s.levelLabel ?? 'Unknown level'}
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            {s.name}
          </CardTitle>
          <CardAction>
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <SquarePen className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-2xl font-semibold tabular-nums text-foreground">
              {s.submitted}
            </span>
            <span className="text-sm text-muted-foreground">
              / {s.active} submitted
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all ${complete ? 'bg-brand-mint' : 'bg-brand-indigo/70'}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </CardContent>
        <CardFooter>
          {complete ? (
            <Badge className="border-transparent bg-brand-mint text-foreground">
              <CheckCircle2 className="mr-1 size-3" />
              Complete
            </Badge>
          ) : started ? (
            <Badge
              variant="outline"
              className="border-brand-indigo/30 bg-brand-indigo/5 text-brand-indigo"
            >
              In progress · {percent}%
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-border bg-muted/40 text-muted-foreground"
            >
              Not started
            </Badge>
          )}
        </CardFooter>
      </Card>
    </Link>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 rounded-md px-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] transition-colors ${
        active
          ? 'bg-primary text-white shadow-sm'
          : 'border border-border bg-card text-muted-foreground hover:border-brand-indigo/40 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
