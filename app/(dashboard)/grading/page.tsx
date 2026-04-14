import Link from 'next/link';
import {
  ArrowUpRight,
  Layers,
  Lock,
  LockOpen,
  Plus,
  Sparkles,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getUserRole } from '@/lib/auth/roles';
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
import { GradingDataTable, type GradingSheetRow } from './grading-data-table';

type LevelLite = { id: string; code: string; label: string; level_type: 'primary' | 'secondary' };
type SubjectLite = { id: string; code: string; name: string; is_examinable: boolean };
type SectionLite = { id: string; name: string; level: LevelLite | LevelLite[] | null };
type TermLite = { id: string; term_number: number; label: string };

type SheetRow = {
  id: string;
  is_locked: boolean;
  teacher_name: string | null;
  term: TermLite | TermLite[] | null;
  subject: SubjectLite | SubjectLite[] | null;
  section: SectionLite | SectionLite[] | null;
};

const first = <T,>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? v[0] ?? null : v ?? null;

export default async function GradingListPage() {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  const role = getUserRole(user.user);
  const canCreate = role === 'registrar' || role === 'admin' || role === 'superadmin';

  const { data: sheets } = await supabase
    .from('grading_sheets')
    .select(
      `id, is_locked, teacher_name,
       term:terms(id, term_number, label),
       subject:subjects(id, code, name, is_examinable),
       section:sections(id, name, level:levels(id, code, label, level_type))`,
    );

  let advisorySections: Array<{ id: string; name: string; level_label: string | null }> = [];
  if (user.user) {
    const { data: advisorAssignments } = await supabase
      .from('teacher_assignments')
      .select('section:sections(id, name, level:levels(label))')
      .eq('teacher_user_id', user.user.id)
      .eq('role', 'form_adviser');
    type AA = {
      section:
        | { id: string; name: string; level: { label: string } | { label: string }[] | null }
        | { id: string; name: string; level: { label: string } | { label: string }[] | null }[]
        | null;
    };
    advisorySections = ((advisorAssignments ?? []) as AA[])
      .map((a) => first(a.section))
      .filter(
        (
          s,
        ): s is {
          id: string;
          name: string;
          level: { label: string } | { label: string }[] | null;
        } => !!s,
      )
      .map((s) => {
        const lvl = first(s.level);
        return { id: s.id, name: s.name, level_label: lvl?.label ?? null };
      });
  }

  const allRows = (sheets ?? []) as SheetRow[];

  // Flatten to GradingSheetRow[] for the data table.
  const tableRows: GradingSheetRow[] = allRows.map((s) => {
    const section = first(s.section);
    const level = first(section?.level ?? null);
    const subject = first(s.subject);
    const term = first(s.term);
    return {
      id: s.id,
      section: section?.name ?? '—',
      level: level?.label ?? 'Unknown',
      subject: subject?.name ?? '—',
      term: term?.label ?? '—',
      teacher: s.teacher_name ?? null,
      is_locked: s.is_locked,
    };
  });

  const totalCount = tableRows.length;
  const lockedCount = tableRows.filter((s) => s.is_locked).length;
  const openCount = totalCount - lockedCount;
  const lockedPct = totalCount > 0 ? Math.round((lockedCount / totalCount) * 100) : 0;
  const distinctLevels = new Set(tableRows.map((r) => r.level)).size;

  return (
    <PageShell>
      {/* Hero header */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Grading
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Grading sheets.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            One sheet per subject × section × term. Click a row to enter scores.
          </p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/grading/new">
              <Plus className="h-4 w-4" />
              New grading sheet
            </Link>
          </Button>
        )}
      </header>

      {/* Stat cards */}
      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <StatCard
            description="Total sheets"
            value={totalCount}
            icon={Layers}
            footerTitle={`${distinctLevels} ${distinctLevels === 1 ? 'level' : 'levels'}`}
            footerDetail="Across every term in the current AY"
          />
          <StatCard
            description="Open"
            value={openCount}
            icon={LockOpen}
            footerTitle="Teachers can edit"
            footerDetail="Draft or in progress"
          />
          <StatCard
            description="Locked"
            value={lockedCount}
            icon={Lock}
            footerTitle={totalCount > 0 ? `${lockedPct}% of sheets` : 'No sheets yet'}
            footerDetail="Post-lock edits require approval"
          />
        </div>
      </div>

      {/* Advisory shortcut */}
      {advisorySections.length > 0 && (
        <Card className="@container/card">
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Form Class Adviser
            </CardDescription>
            <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Sections you advise
            </CardTitle>
            <CardAction>
              <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Sparkles className="size-5" />
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Write the term comments that appear on report cards.
            </p>
            <div className="flex flex-wrap gap-2">
              {advisorySections.map((s) => (
                <Button key={s.id} asChild variant="outline" size="sm">
                  <Link href={`/grading/advisory/${s.id}/comments`}>
                    {s.level_label ? `${s.level_label} · ` : ''}
                    {s.name} · Comments
                    <ArrowUpRight />
                  </Link>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state or data table */}
      {totalCount === 0 ? (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <div className="font-serif text-lg font-semibold text-foreground">
              No grading sheets yet
            </div>
            <div className="text-sm text-muted-foreground">
              {canCreate
                ? 'Create the first sheet for a subject × section × term.'
                : 'Ask the registrar to create a sheet for your class.'}
            </div>
            {canCreate && (
              <Button asChild>
                <Link href="/grading/new">
                  <Plus className="h-4 w-4" />
                  New grading sheet
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <GradingDataTable data={tableRows} />
      )}
    </PageShell>
  );
}

function StatCard({
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
