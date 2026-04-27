import { ArrowLeft, ClipboardList } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ChecklistItemsEditor } from "@/components/sis/checklist-items-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { listChecklistItems } from "@/lib/evaluation/checklist";
import { getSessionUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// SIS Admin · Evaluation checklist topics. Superadmin only.
// Three-axis picker (term × subject × level); inline list + add/edit/delete
// of items for the selected triple.
export default async function EvaluationChecklistsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ term_id?: string; subject_id?: string; level_id?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");
  if (sessionUser.role !== "superadmin") redirect("/sis");

  const sp = await searchParams;
  const service = createServiceClient();

  // Current AY → its terms (T4 excluded from Evaluation per KD #49).
  const { data: ay } = await service.from("academic_years").select("id, ay_code").eq("is_current", true).single();
  if (!ay) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">No current academic year configured.</div>
      </PageShell>
    );
  }

  const { data: termsRaw } = await service
    .from("terms")
    .select("id, label, term_number, is_current")
    .eq("academic_year_id", ay.id)
    .neq("term_number", 4)
    .order("term_number", { ascending: true });
  type TermLite = { id: string; label: string; term_number: number; is_current: boolean };
  const terms = (termsRaw ?? []) as TermLite[];

  const { data: subjectsRaw } = await service.from("subjects").select("id, code, name").order("name");
  type SubjectLite = { id: string; code: string; name: string };
  const subjects = (subjectsRaw ?? []) as SubjectLite[];

  const { data: levelsRaw } = await service.from("levels").select("id, code, label, level_type").order("code");
  type LevelLite = { id: string; code: string; label: string; level_type: string };
  const levels = (levelsRaw ?? []) as LevelLite[];

  const selectedTermId = sp.term_id ?? terms.find((t) => t.is_current)?.id ?? terms[0]?.id ?? "";
  const selectedSubjectId = sp.subject_id ?? subjects[0]?.id ?? "";
  const selectedLevelId = sp.level_id ?? levels[0]?.id ?? "";

  const items =
    selectedTermId && selectedSubjectId && selectedLevelId
      ? await listChecklistItems(selectedTermId, selectedSubjectId, selectedLevelId)
      : [];

  return (
    <PageShell>
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        SIS Admin
      </Link>

      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          SIS Admin · Evaluation checklists
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Checklist topics.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          One list per term × subject × level. Subject teachers tick these off per student during the term; PTC use
          only. Never flows to the report card.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {ay.ay_code}
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            <span className="inline-flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <ClipboardList className="size-4" />
              </div>
              Edit topics
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChecklistItemsEditor
            terms={terms}
            subjects={subjects}
            levels={levels}
            selectedTermId={selectedTermId}
            selectedSubjectId={selectedSubjectId}
            selectedLevelId={selectedLevelId}
            items={items}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}
