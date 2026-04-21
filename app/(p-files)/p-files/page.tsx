import { FolderKanban } from "lucide-react";
import { redirect } from "next/navigation";

import { AySwitcher } from "@/components/admissions/ay-switcher";
import { CompletenessTable } from "@/components/p-files/completeness-table";
import { CompletionByLevelChart } from "@/components/p-files/completion-by-level-chart";
import { RevisionsOverTimeChart } from "@/components/p-files/revisions-over-time-chart";
import { SummaryCards } from "@/components/p-files/summary-cards";
import { TopMissingPanel } from "@/components/p-files/top-missing-panel";
import { ExpiringDocumentsPanel } from "@/components/sis/expiring-documents-panel";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/ui/page-shell";
import { getCurrentAcademicYear, listAyCodes } from "@/lib/academic-year";
import {
  getCompletionByLevel,
  getRevisionsOverTime,
} from "@/lib/p-files/dashboard";
import { getDocumentDashboardData } from "@/lib/p-files/queries";
import {
  getDocumentValidationBacklog,
  getExpiringDocuments,
} from "@/lib/sis/dashboard";
import { getSessionUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export default async function PFilesDashboard({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");
  if (sessionUser.role !== "p-file" && sessionUser.role !== "admin" && sessionUser.role !== "superadmin") redirect("/");

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  if (!currentAy) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">No current academic year configured.</div>
      </PageShell>
    );
  }

  const { ay: ayParam } = await searchParams;
  const ayCodes = await listAyCodes(service);
  const selectedAy = ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;
  const isCurrentAy = selectedAy === currentAy.ay_code;

  const [
    { students, summary },
    byLevel,
    backlog,
    expiring,
    revisions,
  ] = await Promise.all([
    getDocumentDashboardData(selectedAy),
    getCompletionByLevel(selectedAy),
    getDocumentValidationBacklog(selectedAy),
    getExpiringDocuments(selectedAy, 60, 6),
    getRevisionsOverTime(selectedAy, 12),
  ]);

  return (
    <PageShell>
      {/* Hero — canonical pattern (matches /records) */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            P-Files · Document Tracking
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Student document completeness.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Retrieve validated student, parent, and guardian documents. Upload or replace on behalf of parents — prior versions are preserved in revision history.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {selectedAy}
            </Badge>
            {isCurrentAy ? (
              <Badge className="h-7 border-brand-mint bg-brand-mint/30 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink">
                Current
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Historical
              </Badge>
            )}
          </div>
          <AySwitcher current={selectedAy} options={ayCodes} />
        </div>
      </header>

      <SummaryCards summary={summary} />

      {/* Module-specific analytics — documents lens (collection + freshness). */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CompletionByLevelChart data={byLevel} />
        </div>
        <div className="lg:col-span-1">
          <TopMissingPanel data={backlog} limit={6} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RevisionsOverTimeChart data={revisions} />
        </div>
        <div className="lg:col-span-1">
          <ExpiringDocumentsPanel
            rows={expiring}
            ayCode={selectedAy}
            windowDays={60}
            studentHrefBase="/p-files"
            viewAllHref={`/p-files?ay=${selectedAy}`}
          />
        </div>
      </section>

      {/* Legend — placed immediately above the table it documents */}
      <section className="rounded-xl border border-hairline bg-white p-4 text-xs text-muted-foreground">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
          Document Status Legend
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-brand-mint" /> On file
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-brand-amber" /> Pending review
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-destructive" /> Expired
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full border border-border bg-muted" /> Missing
          </span>
        </div>
      </section>

      <CompletenessTable students={students} />

      {/* Trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <FolderKanban className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>{summary.totalStudents.toLocaleString("en-SG")} students</span>
        <span className="text-border">·</span>
        <span>Cache 10m</span>
        <span className="text-border">·</span>
        <span>Audit-logged</span>
      </div>
    </PageShell>
  );
}
