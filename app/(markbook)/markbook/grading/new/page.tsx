import { PageShell } from "@/components/ui/page-shell";
import { getTeacherList } from "@/lib/auth/staff-list";
import { createClient } from "@/lib/supabase/server";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { NewSheetForm } from "./new-sheet-form";

export default async function NewGradingSheetPage() {
  const supabase = await createClient();

  const { data: ay } = await supabase
    .from("academic_years")
    .select("id")
    .eq("is_current", true)
    .single();

  const [termsRes, sectionsRes, subjectsRes, configsRes, teachers] = await Promise.all([
    supabase.from("terms").select("id, term_number, label, is_current").order("term_number"),
    supabase
      .from("sections")
      .select("id, name, level:levels(id, code, label, level_type)")
      .eq("academic_year_id", ay?.id ?? "00000000-0000-0000-0000-000000000000")
      .order("name"),
    supabase.from("subjects").select("id, code, name, is_examinable"),
    supabase
      .from("subject_configs")
      .select("subject_id, level_id, ww_max_slots, pt_max_slots")
      .eq("academic_year_id", ay?.id ?? "00000000-0000-0000-0000-000000000000"),
    getTeacherList(),
  ]);

  return (
    <PageShell>
      <Link
        href="/markbook/grading"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to grading sheets
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Grading · New sheet
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          New grading sheet.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Creates one sheet for the selected{" "}
          <span className="font-medium text-foreground">subject × section × term</span> and seeds
          a blank grade entry for every active student.
        </p>
      </header>

      <NewSheetForm
        terms={termsRes.data ?? []}
        sections={(sectionsRes.data ?? []) as never}
        subjects={subjectsRes.data ?? []}
        configs={configsRes.data ?? []}
        teachers={teachers}
      />
    </PageShell>
  );
}
