import { BookOpen, RefreshCw, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { SisEmptyState } from '@/components/sis/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getTeacherDetail } from '@/lib/sis/teacher-detail';
import { createClient } from '@/lib/supabase/server';

// The classes this teacher holds. Session, role and capability are guarded by
// the layout, which runs for this route and its sibling.
export default async function TeacherClassesPage({
  params,
}: {
  params: Promise<{ teacherId: string }>;
}) {
  const { teacherId } = await params;

  const supabase = await createClient();
  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('ay_code')
    .eq('is_current', true)
    .single();
  const ayCode = (ayRow as { ay_code: string } | null)?.ay_code;
  if (!ayCode) redirect('/sis');

  // Deduped with the layout's call — one round trip between them.
  const teacher = await getTeacherDetail(teacherId, ayCode);
  if (!teacher) notFound();

  const formClasses = teacher.classes.filter((c) => c.role === 'form_adviser');
  const subjectClasses = teacher.classes.filter(
    (c) => c.role === 'subject_teacher'
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Form class
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            <span className="inline-flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <UserCheck className="size-4" />
              </div>
              Writes the report card comments
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {formClasses.length === 0 ? (
            <SisEmptyState
              icon={UserCheck}
              title="No form class this year"
              body={`${teacher.name} teaches subjects but does not run a form class, so there are no report card comments or write-ups for them to do.`}
            />
          ) : (
            <div className="divide-y divide-border">
              {formClasses.map((c) => (
                <ClassRow key={c.assignmentId} row={c} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {subjectClasses.length}{' '}
            {subjectClasses.length === 1 ? 'class' : 'classes'}
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            <span className="inline-flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <BookOpen className="size-4" />
              </div>
              Subject classes
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {subjectClasses.length === 0 ? (
            <SisEmptyState
              icon={BookOpen}
              title="No subject classes this year"
              body={`Nobody has assigned ${teacher.name} a subject yet. Add one from the class's own Teachers tab.`}
            />
          ) : (
            <div className="divide-y divide-border">
              {subjectClasses.map((c) => (
                <ClassRow key={c.assignmentId} row={c} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {teacher.coveringForOthers.length > 0 && (
        <Card>
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Standing in for colleagues
            </CardDescription>
            <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
              <span className="inline-flex items-center gap-2">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink shadow-brand-tile-amber">
                  <RefreshCw className="size-4" />
                </div>
                Also covering
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {teacher.coveringForOthers.map((c) => (
                <div
                  key={c.reliefId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {c.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      For {c.coveredTeacherName} · since{' '}
                      {formatDay(c.startedOn)}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="h-6 border-brand-amber bg-brand-amber-light text-ink"
                  >
                    <RefreshCw className="size-3" />
                    Covering
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ClassRow({
  row,
}: {
  row: Awaited<ReturnType<typeof getTeacherDetail>> extends infer T
    ? T extends { classes: (infer R)[] }
      ? R
      : never
    : never;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <Link
          href={`/sis/sections/${row.sectionId}?tab=teachers`}
          className="text-sm font-semibold text-foreground underline-offset-4 hover:underline"
        >
          {row.role === 'form_adviser'
            ? row.sectionName
            : `${row.subjectName ?? '—'} · ${row.sectionName}`}
        </Link>
        <p className="text-xs text-muted-foreground">
          {row.role === 'form_adviser' ? 'Form class' : row.levelLabel}
        </p>
      </div>
      {row.cover && (
        // Names both people. "Being covered" alone would leave the reader
        // asking the only question that matters.
        <Badge
          variant="outline"
          className="h-6 border-brand-amber bg-brand-amber-light text-ink"
        >
          <RefreshCw className="size-3" />
          {row.cover.reliefTeacherName} covering since{' '}
          {formatDay(row.cover.startedOn)}
        </Badge>
      )}
    </div>
  );
}

/** "12 Aug" — short enough for a badge, unambiguous enough to act on. */
function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  if (!y || !m || !d) return iso;
  return `${d} ${months[m - 1]}`;
}
