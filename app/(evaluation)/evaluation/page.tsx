import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowUpRight, ClipboardCheck, NotebookPen, SquarePen } from 'lucide-react';

import { createClient, getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
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
import { TermOpenToggle } from '@/components/evaluation/term-open-toggle';

// Evaluation module landing page. The real work happens on /evaluation/sections
// (Bite 4) — this page is a light orientation surface describing what the
// module does + jumping into the writeup roster.
export default async function EvaluationHub() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const canToggle =
    sessionUser.role === 'registrar' ||
    sessionUser.role === 'school_admin' ||
    sessionUser.role === 'admin' ||
    sessionUser.role === 'superadmin';

  // Current AY → its T1-T3 terms + window state. Cheap query + used only
  // by the toggle strip on this page.
  const supabase = await createClient();
  const service = createServiceClient();
  const { data: ay } = await supabase
    .from('academic_years')
    .select('id')
    .eq('is_current', true)
    .maybeSingle();
  const { data: termRows } = ay
    ? await supabase
        .from('terms')
        .select('id, label, term_number, is_current, virtue_theme')
        .eq('academic_year_id', ay.id)
        .neq('term_number', 4)
        .order('term_number', { ascending: true })
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
          .from('evaluation_terms')
          .select('term_id, is_open')
          .in('term_id', terms.map((t) => t.id))
      : { data: [] };
  const openByTerm = new Map<string, boolean>(
    ((evalTermRows ?? []) as Array<{ term_id: string; is_open: boolean }>).map((r) => [
      r.term_id,
      r.is_open,
    ]),
  );

  return (
    <PageShell>
      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Student Evaluation · Hub
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Form class adviser write-ups.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          One paragraph per student per term, guided by the virtue theme the registrar set in SIS
          Admin. The write-up is the sole source of the &ldquo;Form Class Adviser&rsquo;s
          Comments&rdquo; field on T1&ndash;T3 report cards. T4 report cards have no comment
          section; the module is inactive for T4.
        </p>
      </header>

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
              <div
                key={t.id}
                className="flex items-center justify-between gap-4 px-5 py-3"
              >
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-[15px] font-semibold text-foreground">
                      {t.label}
                    </span>
                    {t.is_current && (
                      <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
                        current
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {t.virtue_theme
                      ? `Virtue: ${t.virtue_theme}`
                      : 'Virtue theme not set'}
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
      <Card className="@container/card h-full transition-all hover:border-brand-indigo/40 hover:shadow-sm">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {eyebrow}
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            {title}
          </CardTitle>
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
