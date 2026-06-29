import Link from 'next/link';
import { ArrowUpRight, LayoutGrid, Settings, Users, UserX } from 'lucide-react';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { MarkbookSectionsDataTable } from '@/components/markbook/sections-data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { sgToday } from '@/lib/dates';
import { compareLevelLabels } from '@/lib/sis/levels';
import { loadFormAdvisersBySection } from '@/lib/sis/staff';

type LevelLite = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};

export default async function SectionsListPage() {
  const supabase = await createClient();
  const sessionUser = await getSessionUser();
  const canManage =
    sessionUser?.role === 'registrar' ||
    sessionUser?.role === 'school_admin' ||
    sessionUser?.role === 'superadmin';

  const { data: ay } = await supabase
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('is_current', true)
    .single();

  const [sectionsResult, termsResult] = await Promise.all([
    ay
      ? supabase
          .from('sections')
          .select('id, name, level:levels(id, code, label, level_type)')
          .eq('academic_year_id', ay.id)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            name: string;
            level: LevelLite | LevelLite[] | null;
          }>,
        }),
    // terms for termStarted computation (KD #136) — run in parallel with sections
    ay
      ? supabase
          .from('terms')
          .select('start_date')
          .eq('academic_year_id', ay.id)
      : Promise.resolve({ data: [] as Array<{ start_date: string | null }> }),
  ]);

  const sections = sectionsResult.data ?? [];
  const termRows = (termsResult.data ?? []) as Array<{
    start_date: string | null;
  }>;

  // termStarted = the AY's earliest term has started (≤ today SGT). Used to
  // escalate the Generate-index warning (KD #136). Null start_date guarded.
  const today = sgToday();
  const termStarted = termRows.some(
    (t) => !!t.start_date && t.start_date <= today
  );

  const ids = sections.map((s) => s.id);
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

  const adviserMap = ay
    ? await loadFormAdvisersBySection(ids, ay.ay_code)
    : ({} as Record<string, { userId: string; name: string }>);

  const getLevel = (l: LevelLite | LevelLite[] | null): LevelLite | null =>
    Array.isArray(l) ? (l[0] ?? null) : l;

  // Build flat rows for the DataTable
  const allCards = sections.map((s) => {
    const lvl = getLevel(s.level as LevelLite | LevelLite[] | null);
    return {
      id: s.id,
      name: s.name,
      level_id: lvl?.id ?? '',
      level_code: lvl?.code ?? '',
      level_label: lvl?.label ?? 'Unknown',
      active: counts[s.id]?.active ?? 0,
      withdrawn: counts[s.id]?.withdrawn ?? 0,
    };
  });

  // DataTable rows — markbook omits withdrawn count
  const rows = allCards.map((c) => ({
    id: c.id,
    name: c.name,
    levelLabel: c.level_label,
    active: c.active,
    fcaName: adviserMap[c.id]?.name ?? null,
  }));

  // Unique levels for the Level facet, sorted canonically
  const levelMap = new Map<
    string,
    { id: string; code: string; label: string }
  >();
  for (const c of allCards) {
    if (c.level_id && !levelMap.has(c.level_id)) {
      levelMap.set(c.level_id, {
        id: c.level_id,
        code: c.level_code,
        label: c.level_label,
      });
    }
  }
  const levels = Array.from(levelMap.values()).sort((a, b) =>
    compareLevelLabels(a.label, b.label)
  );

  const totalSections = allCards.length;
  const totalActive = allCards.reduce((n, c) => n + c.active, 0);
  const totalWithdrawn = allCards.reduce((n, c) => n + c.withdrawn, 0);

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
            Every section for the current academic year. Click a card to view
            the roster, grading sheets, and attendance. Section setup (create,
            teacher assignments) lives in SIS Admin.
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
            footerTitle={`${levels.length} ${levels.length === 1 ? 'level' : 'levels'}`}
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
            footerTitle={
              totalWithdrawn === 0 ? 'None this year' : 'Still on the roster'
            }
            footerDetail="Kept for audit trail"
          />
        </div>
      </div>

      {/* Sections DataTable — replaces the former pill/card grid.
          Row-actions menu surfaces Generate-index + Generate-sheets for
          registrar+ so they needn't enter SIS Admin (KD #136 item A). */}
      <MarkbookSectionsDataTable
        rows={rows}
        levels={levels}
        role={sessionUser?.role ?? null}
        termStarted={termStarted}
      />
    </PageShell>
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
