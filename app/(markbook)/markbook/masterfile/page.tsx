import { redirect } from 'next/navigation';

import { MasterfileToolbar } from '@/components/markbook/masterfile-toolbar';
import { MasterfileView } from '@/components/markbook/masterfile-view';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { loadMasterfile } from '@/lib/markbook/masterfile';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// HFSE Masterfile (KD #95). Per-level cross-subject grid.
//
// URL params:
//   ?ay=<ay_code>       optional (defaults to current AY); demo can flip
//                        between AY9999 (active/operational) and AY9998
//                        (prior closed AY with full Final Grades + awards)
//                        without using the environment switcher
//   ?level=<level_id>   required (page redirects to first level if omitted)
//   ?class=<section_id> optional (filter to one class; omit for all classes)

export default async function MasterfilePage({
  searchParams,
}: {
  searchParams: Promise<{
    ay?: string;
    level?: string;
    class?: string;
    view?: string;
  }>;
}) {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  if (
    session.role !== 'registrar' &&
    session.role !== 'school_admin' &&
    session.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const sp = await searchParams;
  const supabase = await createClient();
  const service = createServiceClient();
  const currentAyCode = await requireCurrentAyCode(service);

  // Allow the demo / cross-AY review to pick a different AY via ?ay=.
  // Validates the requested code resolves to a real AY before honoring it.
  let ayCode = currentAyCode;
  if (sp.ay && /^AY\d{4}$/.test(sp.ay)) {
    const { data: requested } = await supabase
      .from('academic_years')
      .select('ay_code')
      .eq('ay_code', sp.ay)
      .maybeSingle();
    if (requested) ayCode = (requested as { ay_code: string }).ay_code;
  }

  // List every AY (both prod + test) so the toolbar can offer cross-AY
  // review — useful for the demo (flip between AY9999 active and AY9998
  // closed) and for legitimate prior-year audits.
  const { data: allAysRaw } = await supabase
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  const ayCodes = ((allAysRaw ?? []) as Array<{ ay_code: string }>).map(
    (a) => a.ay_code
  );

  // Resolve AY id and pull every level that has at least one section
  // configured this AY (so the picker doesn't list empty levels).
  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ayRow) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          No academic year configured.
        </div>
      </PageShell>
    );
  }
  const ayId = (ayRow as { id: string }).id;

  const { data: sectionLevelRows } = await supabase
    .from('sections')
    .select('level:levels(id, code, label, level_type)')
    .eq('academic_year_id', ayId);

  type LvlLite = {
    id: string;
    code: string;
    label: string;
    level_type: string;
  };
  const levelMap = new Map<string, LvlLite>();
  for (const row of (sectionLevelRows ?? []) as Array<{
    level: LvlLite | LvlLite[] | null;
  }>) {
    const lvl = Array.isArray(row.level) ? row.level[0] : row.level;
    if (lvl) levelMap.set(lvl.id, lvl);
  }
  const levels = Array.from(levelMap.values()).sort((a, b) => {
    // Primary first, then Secondary; alphabetical within each group.
    if (a.level_type !== b.level_type) {
      return a.level_type === 'primary' ? -1 : 1;
    }
    return a.code.localeCompare(b.code);
  });

  const selectedLevelId =
    sp.level && levels.some((l) => l.id === sp.level)
      ? sp.level
      : (levels[0]?.id ?? null);

  if (!selectedLevelId) {
    return (
      <PageShell>
        <header className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Markbook · Masterfile
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Masterfile.
          </h1>
        </header>
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
          No levels with sections configured for this academic year. Sync the
          roster from Admissions or seed sections from the Master Template
          before reviewing the Masterfile.
        </div>
      </PageShell>
    );
  }

  const payload = await loadMasterfile({
    ayCode,
    levelId: selectedLevelId,
    sectionIds: sp.class ? [sp.class] : undefined,
  });

  if (!payload) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          Could not load Masterfile data.
        </div>
      </PageShell>
    );
  }

  const selectedSectionId =
    sp.class && payload.sections.some((s) => s.id === sp.class)
      ? sp.class
      : null;

  return (
    <PageShell>
      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Markbook · Masterfile
        </p>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {payload.level.label}
          </h1>
          <Badge
            variant="outline"
            className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            {ayCode}
          </Badge>
          <Badge
            variant="outline"
            className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            {payload.rows.length}{' '}
            {payload.rows.length === 1 ? 'student' : 'students'}
          </Badge>
        </div>
        <p className="max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
          A narrative view of where the masterfile stands for this level —
          readiness, outcomes, and who needs follow-up. Award and General
          Average figures compute server-side; incomplete work shows as pending,
          never a fabricated grade. Switch to Table for the full grid, or Export
          to Excel for the complete masterfile sheet.
        </p>
      </header>

      <MasterfileToolbar
        ayCodes={ayCodes}
        selectedAyCode={ayCode}
        levels={levels.map((l) => ({ id: l.id, label: l.label }))}
        selectedLevelId={selectedLevelId}
        sections={payload.sections}
        selectedSectionId={selectedSectionId}
      />

      <MasterfileView
        payload={payload}
        initialView={sp.view === 'table' ? 'table' : 'dashboard'}
      />

      <p className="border-t border-border pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Award thresholds · Bronze ≥ {payload.thresholds.bronzeMin} · Silver ≥{' '}
        {payload.thresholds.silverMin} · Gold ≥ {payload.thresholds.goldMin} ·
        Editable in{' '}
        <span className="text-foreground">SIS Admin → School config</span>
      </p>
    </PageShell>
  );
}
