import { AlertTriangle, ArrowUpRight, CheckCircle2, ClipboardCheck, Clock, NotebookPen, SquarePen, TrendingUp } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ComparisonToolbar } from "@/components/dashboard/comparison-toolbar";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { InsightsPanel } from "@/components/dashboard/insights-panel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PriorityPanel } from "@/components/dashboard/priority-panel";
import {
  SubmissionVelocityDrillCard,
  TimeToSubmitHistogramCard,
  WriteupsBySectionCard,
} from "@/components/evaluation/drills/chart-drill-cards";
import { EvaluationDrillSheet } from "@/components/evaluation/drills/evaluation-drill-sheet";
import { TermOpenToggle } from "@/components/evaluation/term-open-toggle";
import { Alert, AlertDescription, AlertIcon, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { evaluationInsights } from "@/lib/dashboard/insights";
import { formatRangeLabel, resolveRange, type DashboardSearchParams } from "@/lib/dashboard/range";
import { getDashboardWindows } from "@/lib/dashboard/windows";
import {
  getEvaluationKpisRange,
  getEvaluationRegistrarPriority,
  getEvaluationTeacherPriority,
  getSubmissionVelocityRange,
} from "@/lib/evaluation/dashboard";
import { buildAllRowSets } from "@/lib/evaluation/drill";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Evaluation module landing page. The real work happens on /evaluation/sections
// (Bite 4) — this page is a light orientation surface describing what the
// module does + jumping into the writeup roster.
export default async function EvaluationHub({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");
  const resolvedSearch = await searchParams;

  const canToggle =
    sessionUser.role === "registrar" ||
    sessionUser.role === "school_admin" ||
    sessionUser.role === "admin" ||
    sessionUser.role === "superadmin";

  // Current AY → its T1-T3 terms + window state. Cheap query + used only
  // by the toggle strip on this page.
  const supabase = await createClient();
  const service = createServiceClient();
  const { data: ay } = await supabase.from("academic_years").select("id, ay_code").eq("is_current", true).maybeSingle();
  const { data: termRows } = ay
    ? await supabase
        .from("terms")
        .select("id, label, term_number, is_current, virtue_theme")
        .eq("academic_year_id", ay.id)
        .neq("term_number", 4)
        .order("term_number", { ascending: true })
    : { data: [] };
  type TermLite = {
    id: string;
    label: string;
    term_number: number;
    is_current: boolean;
    virtue_theme: string | null;
  };
  const terms = (termRows ?? []) as TermLite[];

  const { data: evalTermRows } =
    terms.length > 0
      ? await service
          .from("evaluation_terms")
          .select("term_id, is_open")
          .in(
            "term_id",
            terms.map((t) => t.id),
          )
      : { data: [] };
  const openByTerm = new Map<string, boolean>(
    ((evalTermRows ?? []) as Array<{ term_id: string; is_open: boolean }>).map((r) => [r.term_id, r.is_open]),
  );

  // Dashboard band — current AY only.
  const ayCode = ay?.ay_code ?? "";
  const windows = ayCode
    ? await getDashboardWindows(ayCode)
    : { term: { thisTerm: null, lastTerm: null }, ay: { thisAY: null, lastAY: null } };
  const rangeInput = ayCode ? resolveRange(resolvedSearch, windows, ayCode) : null;
  const [kpisResult, velocity, drillRowSets] = rangeInput
    ? await Promise.all([
        getEvaluationKpisRange(rangeInput),
        getSubmissionVelocityRange(rangeInput),
        buildAllRowSets({ ayCode, scope: "range", from: rangeInput.from, to: rangeInput.to }),
      ])
    : [null, null, null];
  const comparisonLabel = kpisResult?.comparisonRange
    ? `vs ${formatRangeLabel(kpisResult.comparisonRange)}`
    : undefined;

  // Role-aware PriorityPanel payload — teacher gets pending writeups across
  // their advisory sections; registrar gets pending writeups school-wide.
  const isTeacher = sessionUser.role === "teacher";
  const teacherPriority =
    isTeacher && ayCode
      ? await getEvaluationTeacherPriority({ ayCode, teacherUserId: sessionUser.id })
      : null;
  const registrarPriority =
    canToggle && ayCode ? await getEvaluationRegistrarPriority({ ayCode }) : null;

  const insights = kpisResult
    ? evaluationInsights({
        submissionPct: kpisResult.current.submissionPct,
        submitted: kpisResult.current.submitted,
        expected: kpisResult.current.expected,
        medianTimeToSubmitDays: kpisResult.current.medianTimeToSubmitDays,
        medianTimeToSubmitDaysPrior: kpisResult.comparison?.medianTimeToSubmitDays,
        lateSubmissions: kpisResult.current.lateSubmissions,
      })
    : [];

  // Soft-warn when any T1–T3 term in the current AY lacks a virtue theme.
  // Per KD #28, NULL virtue locks teacher textareas; registrars can still
  // write but face the same content gap on the report card. Surface the gap
  // on the hub so neither role discovers it on a closed dialog.
  const termsMissingVirtue = terms.filter((t) => !t.virtue_theme);

  return (
    <PageShell>
      <DashboardHero
        eyebrow="Student Evaluation · Hub"
        title="Form class adviser write-ups"
        description="One paragraph per student per term, guided by the term's virtue theme. Sole source for T1–T3 report card comments. T4 is inactive."
        badges={ayCode ? [{ label: ayCode }] : []}
      />

      {termsMissingVirtue.length > 0 && (
        <Alert variant="warning">
          <AlertIcon>
            <AlertTriangle className="size-4" />
          </AlertIcon>
          <AlertTitle>Virtue theme not set for {termsMissingVirtue.length} term{termsMissingVirtue.length === 1 ? "" : "s"}</AlertTitle>
          <AlertDescription>
            {termsMissingVirtue.map((t) => t.label).join(" · ")} — write-up textareas stay locked for teachers until a
            virtue theme is configured.{" "}
            {canToggle ? (
              <Link href="/sis/ay-setup" className="font-medium underline underline-offset-2">
                Set virtue themes in AY Setup →
              </Link>
            ) : (
              <span>Ask the registrar to set the virtue theme in AY Setup.</span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {teacherPriority && <PriorityPanel payload={teacherPriority} />}
      {registrarPriority && <PriorityPanel payload={registrarPriority} />}

      {canToggle && rangeInput && kpisResult && velocity && (
        <>
          <ComparisonToolbar
            ayCode={ayCode}
            ayCodes={[ayCode]}
            range={{ from: rangeInput.from, to: rangeInput.to }}
            comparison={
              rangeInput.cmpFrom && rangeInput.cmpTo
                ? { from: rangeInput.cmpFrom, to: rangeInput.cmpTo }
                : null
            }
            termWindows={windows.term}
            ayWindows={windows.ay}
            showAySwitcher={false}
          />

          {insights.length > 0 && <InsightsPanel insights={insights} />}

          <section className="grid gap-4 xl:grid-cols-4">
            <MetricCard
              label="Submission %"
              value={kpisResult.current.submissionPct}
              format="percent"
              icon={TrendingUp}
              intent={kpisResult.current.submissionPct >= 80 ? "good" : "warning"}
              delta={kpisResult.delta ?? undefined}
              deltaGoodWhen="up"
              comparisonLabel={comparisonLabel}
              sparkline={velocity.current.slice(-14)}
              drillSheet={
                <EvaluationDrillSheet
                  target="submission-status"
                  ayCode={ayCode}
                  initialScope="range"
                  initialFrom={rangeInput.from}
                  initialTo={rangeInput.to}
                  initialWriteups={drillRowSets?.writeups}
                />
              }
            />
            <MetricCard
              label="Submitted"
              value={kpisResult.current.submitted}
              icon={CheckCircle2}
              intent="default"
              subtext={`of ${kpisResult.current.expected} expected`}
              drillSheet={
                <EvaluationDrillSheet
                  target="submitted"
                  ayCode={ayCode}
                  initialScope="range"
                  initialFrom={rangeInput.from}
                  initialTo={rangeInput.to}
                  initialWriteups={drillRowSets?.writeups}
                />
              }
            />
            <MetricCard
              label="Median time-to-submit"
              value={kpisResult.current.medianTimeToSubmitDays ?? "—"}
              format="days"
              icon={Clock}
              intent="default"
              deltaGoodWhen="down"
              subtext={
                kpisResult.comparison?.medianTimeToSubmitDays != null
                  ? `${kpisResult.comparison.medianTimeToSubmitDays}d prior`
                  : kpisResult.comparison
                    ? "No prior data"
                    : undefined
              }
              drillSheet={
                <EvaluationDrillSheet
                  target="time-to-submit"
                  ayCode={ayCode}
                  initialScope="range"
                  initialFrom={rangeInput.from}
                  initialTo={rangeInput.to}
                  initialWriteups={drillRowSets?.writeups}
                />
              }
            />
            <MetricCard
              label="Late submissions"
              value={kpisResult.current.lateSubmissions}
              icon={Clock}
              intent={kpisResult.current.lateSubmissions > 0 ? "warning" : "good"}
              deltaGoodWhen="down"
              subtext={
                kpisResult.comparison
                  ? `${kpisResult.comparison.lateSubmissions} prior`
                  : undefined
              }
              drillSheet={
                <EvaluationDrillSheet
                  target="late"
                  ayCode={ayCode}
                  initialScope="range"
                  initialFrom={rangeInput.from}
                  initialTo={rangeInput.to}
                  initialWriteups={drillRowSets?.writeups}
                />
              }
            />
          </section>

          {velocity.current.length > 1 && (
            <SubmissionVelocityDrillCard
              current={velocity.current}
              comparison={velocity.comparison}
              ayCode={ayCode}
              rangeFrom={rangeInput.from}
              rangeTo={rangeInput.to}
              initialWriteups={drillRowSets?.writeups}
            />
          )}

          {drillRowSets && (drillRowSets.bySection.length > 0 || drillRowSets.buckets.some((b) => b.count > 0)) && (
            <section className="grid gap-4 lg:grid-cols-2">
              <WriteupsBySectionCard
                data={drillRowSets.bySection}
                ayCode={ayCode}
                rangeFrom={rangeInput.from}
                rangeTo={rangeInput.to}
                initialBySection={drillRowSets.bySection}
                initialWriteups={drillRowSets.writeups}
              />
              <TimeToSubmitHistogramCard
                data={drillRowSets.buckets}
                ayCode={ayCode}
                rangeFrom={rangeInput.from}
                rangeTo={rangeInput.to}
                initialBuckets={drillRowSets.buckets}
                initialWriteups={drillRowSets.writeups}
              />
            </section>
          )}
        </>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <HubCard
          href="/evaluation/sections"
          icon={SquarePen}
          eyebrow="Write-ups"
          title="My sections"
          description="Write or revise the adviser paragraph for each student in your section. Guided by the term's virtue theme. Autosaves per keystroke; Submit marks a write-up finalised."
          cta="Open roster"
        />
        <HubCard
          href="/sis/ay-setup"
          icon={NotebookPen}
          eyebrow="Configuration"
          title="Virtue theme"
          description="Set in SIS Admin → Term dates, per term. The theme appears as a prompt to advisers and as the parenthetical on printed report cards."
          cta="Open AY Setup"
        />
      </section>

      {/* Evaluation-window open/close toggle strip (registrar+). Teachers
          see the open/closed state read-only; they're gated by it, not
          controlling it. */}
      {terms.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Evaluation window
          </h2>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {terms.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-[15px] font-semibold text-foreground">{t.label}</span>
                    {t.is_current && (
                      <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
                        current
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {t.virtue_theme ? `Virtue: ${t.virtue_theme}` : "Virtue theme not set"}
                  </div>
                </div>
                <TermOpenToggle
                  termId={t.id}
                  termLabel={t.label}
                  isOpen={openByTerm.get(t.id) ?? false}
                  canToggle={canToggle}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <ClipboardCheck className="size-3" strokeWidth={2.25} />
        <span>KD #49 — Evaluation owns the FCA write-up</span>
        <span className="text-border">·</span>
        <span>Checklists &amp; PTC deferred to follow-up sprint</span>
      </div>
    </PageShell>
  );
}

function HubCard({
  href,
  icon: Icon,
  eyebrow,
  title,
  description,
  cta,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
}) {
  return (
    <Link href={href}>
      <Card className="@container/card h-full transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-md">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {eyebrow}
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">{title}</CardTitle>
          <CardAction>
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Icon className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        </CardContent>
        <CardFooter>
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            {cta}
            <ArrowUpRight className="size-3.5" />
          </span>
        </CardFooter>
      </Card>
    </Link>
  );
}
