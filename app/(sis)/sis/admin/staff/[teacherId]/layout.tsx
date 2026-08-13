import { BookOpen, RefreshCw, UserCheck } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';

import { SisPageHeader } from '@/components/sis/sis-page-header';
import { TeacherAssignmentEditorButton } from '@/components/sis/teacher-assignment-editor-button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getTeacherDetail } from '@/lib/sis/teacher-detail';
import { createClient, getSessionUser } from '@/lib/supabase/server';

// One teacher — everything they hold this year, and who is standing in on any
// of it.
//
// This exists because a teacher's classes previously lived only inside a
// slide-out drawer on the staff table: no address of its own, so it could not
// be linked, bookmarked or sent to anyone. The drawer stays for quick edits
// from the table; this is the durable view.
//
// Cover is arranged on the class itself, one row at a time — there is no Cover
// tab and no dialog up here. Somebody is standing in on a class or nobody is,
// so the control belongs beside the class, not behind a page-level button that
// then has to ask which class it meant.
//
// `getTeacherDetail` is request-deduped, so the layout and the page beneath it
// cost one round trip between them, not two.

export default async function TeacherLayout({
  params,
  children,
}: {
  params: Promise<{ teacherId: string }>;
  children: React.ReactNode;
}) {
  const { teacherId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser?.role) redirect('/login');

  const capabilities = await getCapabilitiesForRole(sessionUser.role);
  // The parent layout already refused anyone below academic_coordinator. This
  // is the capability the page's own data turns on, checked here because a URL
  // can be typed.
  if (!can(capabilities, 'staff.read')) redirect('/sis');
  const canEditAssignments = can(capabilities, 'staff.edit_assignments');

  const supabase = await createClient();
  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('ay_code')
    .eq('is_current', true)
    .single();
  const ayCode = (ayRow as { ay_code: string } | null)?.ay_code;
  if (!ayCode) redirect('/sis');

  const teacher = await getTeacherDetail(teacherId, ayCode);
  if (!teacher) notFound();

  const formClasses = teacher.classes.filter((c) => c.role === 'form_adviser');
  const subjectClasses = teacher.classes.filter(
    (c) => c.role === 'subject_teacher'
  );
  const coveredCount = teacher.classes.filter((c) => c.cover !== null).length;

  return (
    <>
      <SisPageHeader
        group="Staff · This year"
        title={teacher.name}
        description={teacher.email ?? 'No email address on record.'}
        chips={
          teacher.coveringForOthers.length > 0 ? (
            <Badge
              variant="outline"
              className="h-7 border-brand-amber bg-brand-amber-light px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink"
            >
              <RefreshCw className="mr-1.5 size-3" />
              Covering {teacher.coveringForOthers.length} for others
            </Badge>
          ) : undefined
        }
        actions={
          <TeacherAssignmentEditorButton
            teacher={{
              userId: teacher.userId,
              name: teacher.name,
              email: teacher.email ?? '',
            }}
            ayCode={ayCode}
            canEdit={canEditAssignments}
          />
        }
      />

      <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:shadow-xs sm:grid-cols-3">
        <Card
          data-slot="card"
          className="bg-gradient-to-t from-primary/5 to-card"
        >
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Form class
            </CardDescription>
            <CardTitle className="font-serif text-3xl tabular-nums text-foreground">
              {formClasses.length}
            </CardTitle>
            <CardAction>
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <UserCheck className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
        </Card>

        <Card
          data-slot="card"
          className="bg-gradient-to-t from-primary/5 to-card"
        >
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Subject classes
            </CardDescription>
            <CardTitle className="font-serif text-3xl tabular-nums text-foreground">
              {subjectClasses.length}
            </CardTitle>
            <CardAction>
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <BookOpen className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
        </Card>

        {/* Amber only when it is true. A permanently amber tile reading zero
            teaches the eye to ignore the colour. */}
        <Card
          data-slot="card"
          className={
            coveredCount > 0
              ? 'border-brand-amber/30 bg-gradient-to-r from-brand-amber/10 to-card'
              : 'bg-gradient-to-t from-primary/5 to-card'
          }
        >
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Being covered
            </CardDescription>
            <CardTitle
              className={`font-serif text-3xl tabular-nums ${coveredCount > 0 ? 'text-brand-amber' : 'text-foreground'}`}
            >
              {coveredCount}
            </CardTitle>
            <CardAction>
              <div
                className={`flex size-9 items-center justify-center rounded-xl ${
                  coveredCount > 0
                    ? 'bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink shadow-brand-tile-amber'
                    : 'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile'
                }`}
              >
                <RefreshCw className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
        </Card>
      </div>

      <div className="space-y-4">{children}</div>
    </>
  );
}
