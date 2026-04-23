import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { ArrowLeft, ArrowUpRight, Calendar, Clock, MessageSquare, UserCheck, UserCog, UserMinus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ManualAddStudent } from "./manual-add";
import { RosterTable, type RosterRow } from "./roster-table";
import { SectionAttendanceSummary } from "@/components/markbook/section-attendance-summary";

type LevelLite = { id: string; code: string; label: string; level_type: "primary" | "secondary" };

type EnrolmentRow = {
  id: string;
  index_number: number;
  enrollment_status: "active" | "late_enrollee" | "withdrawn";
  enrollment_date: string | null;
  withdrawal_date: string | null;
  bus_no: string | null;
  classroom_officer_role: string | null;
  student: {
    id: string;
    student_number: string;
    last_name: string;
    first_name: string;
    middle_name: string | null;
  } | null;
};

export default async function SectionRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const sessionUser = await getSessionUser();
  const canManage =
    sessionUser?.role === "registrar" ||
    sessionUser?.role === "school_admin" ||
    sessionUser?.role === "admin" ||
    sessionUser?.role === "superadmin";

  const { data: section } = await supabase
    .from("sections")
    .select("id, name, academic_year_id, level:levels(id, code, label, level_type)")
    .eq("id", id)
    .single();
  if (!section) notFound();

  const { data: rows } = await supabase
    .from("section_students")
    .select(
      "id, index_number, enrollment_status, enrollment_date, withdrawal_date, bus_no, classroom_officer_role, student:students(id, student_number, last_name, first_name, middle_name)",
    )
    .eq("section_id", id)
    .order("index_number");

  // Current term for this section's AY — used by the read-only attendance summary
  // card (rolls up from the Attendance module's daily ledger).
  const { data: currentTerm } = await supabase
    .from("terms")
    .select("id, label")
    .eq("academic_year_id", section.academic_year_id)
    .eq("is_current", true)
    .maybeSingle();

  const levelFromSection = (Array.isArray(section.level) ? section.level[0] : section.level) as LevelLite | null;

  const enrolments = (rows ?? []) as unknown as EnrolmentRow[];
  const level = levelFromSection;
  const activeCount = enrolments.filter((e) => e.enrollment_status === "active").length;
  const lateCount = enrolments.filter((e) => e.enrollment_status === "late_enrollee").length;
  const withdrawnCount = enrolments.filter((e) => e.enrollment_status === "withdrawn").length;
  const onRosterCount = activeCount + lateCount;
  const nextIndex = Math.max(0, ...enrolments.map((e) => e.index_number)) + 1;

  const rosterRows: RosterRow[] = enrolments.map((e) => {
    const s = e.student;
    return {
      id: e.id,
      index_number: e.index_number,
      student_number: s?.student_number ?? "",
      student_name: s ? [s.last_name, s.first_name, s.middle_name].filter(Boolean).join(", ") : "(missing student)",
      enrollment_status: e.enrollment_status,
      bus_no: e.bus_no,
      classroom_officer_role: e.classroom_officer_role,
    };
  });

  return (
    <PageShell>
      <Link
        href="/markbook/sections"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to sections
      </Link>

      {/* Hero */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Administration · Section
          </p>
          <div className="flex items-baseline gap-3">
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              {section.name}
            </h1>
            {level && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">
                {level.label}
              </Badge>
            )}
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {onRosterCount} on the roster
            {withdrawnCount > 0 && ` · ${withdrawnCount} withdrawn (kept for audit)`}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/sis/sections/${section.id}?tab=teachers`}>
                <UserCog className="h-4 w-4" />
                Manage teachers
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={`/evaluation/sections/${section.id}`}>
              <MessageSquare className="h-4 w-4" />
              Write-ups
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/markbook/sections/${section.id}/attendance`}>
              <Calendar className="h-4 w-4" />
              Attendance
            </Link>
          </Button>
          <ManualAddStudent sectionId={section.id} nextIndex={nextIndex} />
        </div>
      </header>

      {/* Stat cards */}
      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <StatCard
            description="Active"
            value={activeCount}
            icon={UserCheck}
            footerTitle="On the roster"
            footerDetail="Currently enrolled"
          />
          <StatCard
            description="Late enrollees"
            value={lateCount}
            icon={Clock}
            footerTitle={lateCount === 0 ? "None" : "Started after term began"}
            footerDetail="Pre-enrolment scores marked N/A"
          />
          <StatCard
            description="Withdrawn"
            value={withdrawnCount}
            icon={UserMinus}
            footerTitle={withdrawnCount === 0 ? "None this year" : "Retained for audit"}
            footerDetail="Kept in the roster permanently"
          />
        </div>
      </div>

      {/* Attendance summary — reads the Attendance module's rollup. */}
      {currentTerm && (
        <SectionAttendanceSummary
          sectionId={section.id}
          termId={currentTerm.id}
          termLabel={currentTerm.label}
        />
      )}

      {/* Roster */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Roster
            <span className="ml-2 font-mono text-[10px] text-muted-foreground">
              {enrolments.length}
            </span>
          </h2>
        </div>
        <RosterTable data={rosterRows} sectionId={section.id} />
      </div>
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
          {value.toLocaleString("en-SG")}
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
