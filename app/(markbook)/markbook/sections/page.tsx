import Link from 'next/link';
import {
  ArrowUpRight,
  ChevronRight,
  GraduationCap,
  LayoutGrid,
  School,
  Settings,
  Users,
  UserX,
} from 'lucide-react';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';

type LevelLite = { id: string; code: string; label: string; level_type: 'primary' | 'secondary' };
type SectionCard = {
  id: string;
  name: string;
  level_label: string;
  level_type: 'primary' | 'secondary' | 'unknown';
  active: number;
  withdrawn: number;
};

export default async function SectionsListPage() {
  const supabase = await createClient();
  const sessionUser = await getSessionUser();
  const canManage =
    sessionUser?.role === 'registrar' ||
    sessionUser?.role === 'school_admin' ||
    sessionUser?.role === 'admin' ||
    sessionUser?.role === 'superadmin';

  const { data: ay } = await supabase
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('is_current', true)
    .single();

  const { data: sections } = ay
    ? await supabase
        .from('sections')
        .select('id, name, level:levels(id, code, label, level_type)')
        .eq('academic_year_id', ay.id)
    : { data: [] as Array<{ id: string; name: string; level: LevelLite | LevelLite[] | null }> };

  const ids = (sections ?? []).map((s) => s.id);
  const counts: Record<string, { active: number; withdrawn: number }> = {};
  if (ids.length > 0) {
    const { data: enrolments } = await supabase
      .from('section_students')
      .select('section_id, enrollment_status')
      .in('section_id', ids);
    for (const row of enrolments ?? []) {
      const b = (counts[row.section_id] ??= { active: 0, withdrawn: 0 });
      if (row.enrollment_status === 'withdrawn') b.withdrawn++;
      else b.active++;
    }
  }

  const getLevel = (l: LevelLite | LevelLite[] | null): LevelLite | null =>
    Array.isArray(l) ? l[0] ?? null : l;

  const cards: SectionCard[] = (sections ?? []).map((s) => {
    const lvl = getLevel(s.level as LevelLite | LevelLite[] | null);
    return {
      id: s.id,
      name: s.name,
      level_label: lvl?.label ?? 'Unknown',
      level_type: (lvl?.level_type ?? 'unknown') as SectionCard['level_type'],
      active: counts[s.id]?.active ?? 0,
      withdrawn: counts[s.id]?.withdrawn ?? 0,
    };
  });

  const grouped = new Map<string, SectionCard[]>();
  for (const c of cards) {
    if (!grouped.has(c.level_label)) grouped.set(c.level_label, []);
    grouped.get(c.level_label)!.push(c);
  }
  const sortedLevels = Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));

  const totalSections = cards.length;
  const totalActive = cards.reduce((n, c) => n + c.active, 0);
  const totalWithdrawn = cards.reduce((n, c) => n + c.withdrawn, 0);

  return (
    <PageShell>
      {/* Hero */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Markbook · Rosters
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Sections & advisers.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Every section for the current academic year. Click a card to view the roster, grading
            sheets, and attendance. Section setup (create, teacher assignments) lives in SIS
            Admin.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ay && (
            <Badge
              variant="outline"
              className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {ay.ay_code}
            </Badge>
          )}
          {canManage && (
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link href="/sis/sections">
                <Settings className="size-3.5" />
                Manage in SIS Admin
                <ArrowUpRight className="size-3" />
              </Link>
            </Button>
          )}
        </div>
      </header>

      {/* Stats */}
      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <SummaryCard
            description="Total sections"
            value={totalSections}
            icon={LayoutGrid}
            footerTitle={`${sortedLevels.length} ${sortedLevels.length === 1 ? 'level' : 'levels'}`}
            footerDetail={ay?.label ?? 'No current AY'}
          />
          <SummaryCard
            description="Active students"
            value={totalActive}
            icon={Users}
            footerTitle="Currently enrolled"
            footerDetail="Across every section in the current AY"
          />
          <SummaryCard
            description="Withdrawn"
            value={totalWithdrawn}
            icon={UserX}
            footerTitle={totalWithdrawn === 0 ? 'None this year' : 'Still on the roster'}
            footerDetail="Kept for audit trail"
          />
        </div>
      </div>

      {/* Empty state */}
      {sortedLevels.length === 0 && (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <div className="font-serif text-lg font-semibold text-foreground">
              No sections yet
            </div>
            <div className="text-sm text-muted-foreground">
              {canManage ? (
                <>
                  Create sections for the current AY in{' '}
                  <Link href="/sis/sections" className="font-medium text-foreground underline">
                    SIS Admin
                  </Link>
                  .
                </>
              ) : (
                <>Ask the registrar to create sections for the current AY.</>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grouped sections — each level is one big container Card with a list of section rows */}
      {sortedLevels.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            By level
          </h2>
          <div className="space-y-5">
            {sortedLevels.map(([level, sects]) => {
              const levelActive = sects.reduce((n, s) => n + s.active, 0);
              const sorted = sects.slice().sort((a, b) => a.name.localeCompare(b.name));
              return (
                <Card key={level} className="@container/card gap-0 py-0">
                  <CardHeader className="border-b border-border py-5">
                    <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                      Level
                    </CardDescription>
                    <CardTitle className="font-serif text-[22px] font-semibold tracking-tight text-foreground">
                      {level}
                    </CardTitle>
                    <CardAction>
                      <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                        <School className="size-5" />
                      </div>
                    </CardAction>
                  </CardHeader>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-muted/30 px-6 py-3">
                    <MetaBlock
                      label="Sections"
                      value={sects.length.toLocaleString('en-SG')}
                    />
                    <MetaBlock
                      label="Active students"
                      value={levelActive.toLocaleString('en-SG')}
                    />
                  </div>
                  <ul className="divide-y divide-border">
                    {sorted.map((s) => (
                      <SectionRow key={s.id} section={s} />
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </PageShell>
  );
}

function MetaBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="font-serif text-base font-semibold tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

function SectionRow({ section }: { section: SectionCard }) {
  return (
    <li>
      <Link
        href={`/markbook/sections/${section.id}`}
        className="group flex items-center gap-4 px-6 py-4 transition-colors hover:bg-muted/40"
      >
        <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <GraduationCap className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[17px] font-semibold leading-snug tracking-tight text-foreground">
            {section.name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
            <span className="font-mono tabular-nums text-foreground">
              {section.active}
              <span className="ml-1 text-muted-foreground">active</span>
            </span>
            {section.withdrawn > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {section.withdrawn}
                  <span className="ml-1">withdrawn</span>
                </span>
              </>
            )}
          </div>
        </div>
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      </Link>
    </li>
  );
}

function SummaryCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
}: {
  description: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  footerTitle: string;
  footerDetail: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {description}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {value.toLocaleString('en-SG')}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">{footerTitle}</p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
    </Card>
  );
}

