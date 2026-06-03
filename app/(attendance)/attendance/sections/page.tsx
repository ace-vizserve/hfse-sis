import Link from 'next/link';
import { GraduationCap, School, Users } from 'lucide-react';

import { createClient, getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';
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
import { PageShell } from '@/components/ui/page-shell';
import { compareLevelLabels } from '@/lib/sis/levels';

type LevelLite = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};
type SectionCard = {
  id: string;
  name: string;
  level_label: string;
  level_code: string;
  active: number;
};

export default async function AttendanceSectionsListPage() {
  const session = await getSessionUser();
  const role = session?.role ?? null;
  const isTeacherOnly = role === 'teacher';

  const supabase = await createClient();

  const { data: ay } = await supabase
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('is_current', true)
    .single();

  // Scope by academic_year_id — terms.is_current can be true across
  // multiple AYs (the wipe-AY2026/27 script preserved terms rows along
  // with their is_current flag, so an unscoped query returns the wrong
  // AY's term). Pair with today's-date fallback so the badge stays
  // honest even if no term has is_current set.
  const today = sgToday();
  const { data: currentTerm } = ay
    ? await supabase
        .from('terms')
        .select('id, label, start_date, end_date, is_current')
        .eq('academic_year_id', ay.id)
        .order('term_number', { ascending: true })
    : {
        data: [] as Array<{
          id: string;
          label: string;
          start_date: string | null;
          end_date: string | null;
          is_current: boolean;
        }>,
      };
  type TermRow = {
    id: string;
    label: string;
    start_date: string | null;
    end_date: string | null;
    is_current: boolean;
  };
  const termRows = (currentTerm ?? []) as TermRow[];
  const activeTerm =
    termRows.find(
      (t) =>
        t.start_date &&
        t.end_date &&
        t.start_date <= today &&
        t.end_date >= today
    ) ??
    termRows.find((t) => t.is_current) ??
    null;

  let allowedSectionIds: Set<string> | null = null;
  if (isTeacherOnly && session?.id && ay) {
    const service = createServiceClient();
    const { data: assignments } = await service
      .from('teacher_assignments')
      .select('section_id, sections!inner(academic_year_id)')
      .eq('teacher_user_id', session.id)
      .eq('role', 'form_adviser')
      .eq('sections.academic_year_id', ay.id);
    allowedSectionIds = new Set(
      ((assignments ?? []) as Array<{ section_id: string }>).map(
        (a) => a.section_id
      )
    );
  }

  const { data: sections } = ay
    ? await supabase
        .from('sections')
        .select('id, name, level:levels(id, code, label, level_type)')
        .eq('academic_year_id', ay.id)
    : {
        data: [] as Array<{
          id: string;
          name: string;
          level: LevelLite | LevelLite[] | null;
        }>,
      };

  const ids = (sections ?? []).map((s) => s.id);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: enrolments } = await supabase
      .from('section_students')
      .select('section_id, enrollment_status')
      .in('section_id', ids);
    for (const row of enrolments ?? []) {
      if (row.enrollment_status !== 'withdrawn') {
        counts[row.section_id] = (counts[row.section_id] ?? 0) + 1;
      }
    }
  }

  const getLevel = (l: LevelLite | LevelLite[] | null): LevelLite | null =>
    Array.isArray(l) ? (l[0] ?? null) : l;

  const cards: SectionCard[] = (sections ?? [])
    .filter((s) => !allowedSectionIds || allowedSectionIds.has(s.id))
    .map((s) => {
      const lvl = getLevel(s.level as LevelLite | LevelLite[] | null);
      return {
        id: s.id,
        name: s.name,
        level_label: lvl?.label ?? 'Unknown',
        level_code: lvl?.code ?? '',
        active: counts[s.id] ?? 0,
      };
    });

  const grouped = new Map<string, SectionCard[]>();
  for (const c of cards) {
    if (!grouped.has(c.level_label)) grouped.set(c.level_label, []);
    grouped.get(c.level_label)!.push(c);
  }
  // Canonical pedagogical order (YS-L → YS-J → YS-S → P1 → … → S4 → CS1
  // → CS2) per `lib/sis/levels.ts`. localeCompare gave alphabetical
  // ordering which read wrong ("Primary Five" before "Primary One").
  const sortedLevels = Array.from(grouped.entries()).sort(([a], [b]) =>
    compareLevelLabels(a, b)
  );
  for (const [, sects] of sortedLevels) {
    sects.sort((a, b) => a.name.localeCompare(b.name));
  }

  const totalSections = cards.length;
  const totalActive = cards.reduce((n, c) => n + c.active, 0);

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Attendance · Daily entry
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {isTeacherOnly ? 'Your sections.' : 'Pick a section.'}
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {isTeacherOnly
              ? 'The sections you form-advise. Click through to mark daily attendance for the chosen date.'
              : 'Every section in the current academic year. Click through to mark or review daily attendance.'}
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
          {activeTerm && (
            <Badge
              variant="outline"
              className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {activeTerm.label}
            </Badge>
          )}
        </div>
      </header>

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2">
          <SummaryCard
            description={isTeacherOnly ? 'Your sections' : 'Total sections'}
            value={totalSections}
            icon={School}
            footerTitle={`${sortedLevels.length} ${sortedLevels.length === 1 ? 'level' : 'levels'}`}
            footerDetail={ay?.label ?? 'No current AY'}
          />
          <SummaryCard
            description="Students covered"
            value={totalActive}
            icon={Users}
            footerTitle="Currently enrolled"
            footerDetail="Across the sections above"
          />
        </div>
      </div>

      {sortedLevels.length === 0 && (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <div className="font-serif text-lg font-semibold text-foreground">
              {isTeacherOnly ? 'No sections assigned' : 'No sections yet'}
            </div>
            <div className="text-sm text-muted-foreground">
              {isTeacherOnly
                ? 'The registrar has not assigned you as a form adviser for any section yet.'
                : 'Run the seed SQL or ask the registrar to create sections for the current AY.'}
            </div>
          </CardContent>
        </Card>
      )}

      {sortedLevels.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            By level
          </h2>
          <div className="space-y-4">
            {sortedLevels.map(([level, sects]) => (
              <LevelGroup
                key={level}
                levelLabel={level}
                sections={sects}
                today={today}
              />
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}

function LevelGroup({
  levelLabel,
  sections,
  today,
}: {
  levelLabel: string;
  sections: SectionCard[];
  today: string;
}) {
  const levelCode = sections[0]?.level_code ?? '';
  const totalActive = sections.reduce((n, s) => n + s.active, 0);
  return (
    <Card className="@container/card gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-3">
        {levelCode && (
          <Badge
            variant="outline"
            className="h-6 border-border bg-white px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            {levelCode}
          </Badge>
        )}
        <div className="font-serif text-[15px] font-semibold tracking-tight text-foreground">
          {levelLabel}
        </div>
        <Badge variant="muted" className="ml-auto">
          {sections.length} section{sections.length === 1 ? '' : 's'}
          <span className="ml-1.5 text-muted-foreground">·</span>
          <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">
            {totalActive} active
          </span>
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2 p-4">
        {sections.map((s) => (
          <SectionPill key={s.id} section={s} today={today} />
        ))}
      </div>
    </Card>
  );
}

function SectionPill({
  section,
  today,
}: {
  section: SectionCard;
  today: string;
}) {
  return (
    <Link
      href={`/attendance/${section.id}?date=${today}`}
      className="group/pill inline-flex items-center gap-2.5 rounded-xl border border-hairline bg-gradient-to-b from-card to-muted/20 py-2 pl-2.5 pr-3 shadow-xs transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-md"
    >
      <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <GraduationCap className="size-3.5" />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="font-serif text-[14px] font-semibold tracking-tight text-foreground">
          {section.name}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] tabular-nums text-muted-foreground">
          {section.active} active
        </span>
      </div>
    </Link>
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
