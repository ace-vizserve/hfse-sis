import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, BookOpenCheck } from 'lucide-react';

import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { PageShell } from '@/components/ui/page-shell';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  listLevels,
  listSubjects,
  listSubjectConfigsForAy,
} from '@/lib/sis/subjects/queries';
import { SubjectConfigMatrix } from '@/components/sis/subject-config-matrix';
import { SubjectAySwitcher } from '@/components/sis/subject-ay-switcher';

// Subject weights + max-slots matrix. Superadmin only. Changing here affects
// every grading sheet for the (subject × level) inside the selected AY.
export default async function SubjectConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (sessionUser.role !== 'superadmin') redirect('/sis');

  const sp = await searchParams;
  const service = createServiceClient();

  // Academic-year options + current selection.
  const { data: ays } = await service
    .from('academic_years')
    .select('id, ay_code, label, is_current')
    .order('ay_code', { ascending: false });
  type AyRow = { id: string; ay_code: string; label: string; is_current: boolean };
  const ayList = ((ays ?? []) as AyRow[]);
  const currentAy: AyRow | null =
    (sp.ay ? ayList.find((a) => a.ay_code === sp.ay) : undefined) ??
    ayList.find((a) => a.is_current) ??
    ayList[0] ??
    null;

  const [subjects, levels, configs] = currentAy
    ? await Promise.all([
        listSubjects(),
        listLevels(),
        listSubjectConfigsForAy(currentAy.id),
      ])
    : [[], [], []];

  const ayOptions = ayList.map((a) => ({
    ayCode: a.ay_code,
    label: a.label,
    isCurrent: a.is_current,
  }));

  return (
    <PageShell>
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        SIS Admin
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            SIS Admin · Subject weights
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Subject weights &amp; slots.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            WW / PT / QA weights and max slot counts per subject + level + AY. Changes here apply to
            <strong> every grading sheet</strong> for that subject + level — handle with care.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {currentAy && (
            <Badge
              variant="outline"
              className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {currentAy.ay_code}
            </Badge>
          )}
          <SubjectAySwitcher
            current={currentAy?.ay_code ?? ''}
            options={ayOptions}
          />
        </div>
      </header>

      {!currentAy ? (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <BookOpenCheck className="size-6 text-muted-foreground" />
            <div className="font-serif text-lg font-semibold text-foreground">
              No academic years
            </div>
            <p className="text-sm text-muted-foreground">Create an AY first via AY Setup.</p>
          </CardContent>
        </Card>
      ) : (
        <SubjectConfigMatrix
          subjects={subjects}
          levels={levels}
          configs={configs}
          ayCode={currentAy.ay_code}
        />
      )}
    </PageShell>
  );
}
