'use client';

import { FileSpreadsheet, LayoutDashboard, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MasterfileDashboard } from '@/components/markbook/masterfile-dashboard';
import { MasterfileGrid } from '@/components/markbook/masterfile-grid';
import type {
  MasterfileDashboardFilters,
  MasterfileStatusFilter,
} from '@/lib/markbook/masterfile-dashboard';
import type { MasterfilePayload } from '@/lib/markbook/masterfile';
import { cn } from '@/lib/utils';

// Masterfile surface shell (KD #95). Holds the always-visible toolbar — view
// toggle (Dashboard | Table), the dashboard refinement filters (Term / Subject
// / Status), and the Export-to-Excel button (lifted out of the grid so it's
// available in both views). Default view = Dashboard.
//
// The Term / Subject / Status filters drive the dashboard client-side (all the
// data is already in the payload, so no server round-trip). The Table view
// renders the existing wide grid unchanged — it carries its own award + status
// + name filters, so the dashboard filters don't apply there.

type ViewMode = 'dashboard' | 'table';

const STATUS_OPTIONS: Array<{ value: MasterfileStatusFilter; label: string }> =
  [
    { value: 'all', label: 'All statuses' },
    { value: 'active', label: 'Active only' },
    { value: 'late_enrollee', label: 'Late enrolment' },
    { value: 'withdrawn', label: 'Withdrawn' },
  ];

export function MasterfileView({
  payload,
  initialView,
}: {
  payload: MasterfilePayload;
  initialView?: ViewMode;
}) {
  const [view, setView] = useState<ViewMode>(initialView ?? 'dashboard');
  const [termNumber, setTermNumber] = useState<number | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [status, setStatus] = useState<MasterfileStatusFilter>('all');

  const filters: MasterfileDashboardFilters = useMemo(
    () => ({ termNumber, status, subjectId }),
    [termNumber, status, subjectId]
  );

  // Export link mirrors the current ?ay / ?level / ?class scope. The Excel
  // workbook is the full masterfile sheet — the dashboard refinement filters
  // (term / subject / status) intentionally don't narrow it.
  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set('ay', payload.ayCode);
    params.set('level', payload.level.id);
    for (const id of payload.selectedSectionIds ?? [])
      params.append('class', id);
    return `/api/markbook/masterfile/export?${params.toString()}`;
  }, [payload.ayCode, payload.level.id, payload.selectedSectionIds]);

  return (
    <div className="flex flex-col gap-6">
      {/* Toolbar — view toggle + dashboard filters + export */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* View toggle */}
          <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
            <ToggleButton
              active={view === 'dashboard'}
              onClick={() => setView('dashboard')}
              icon={LayoutDashboard}
              label="Dashboard"
            />
            <ToggleButton
              active={view === 'table'}
              onClick={() => setView('table')}
              icon={Table2}
              label="Table"
            />
          </div>

          {view === 'dashboard' && (
            <>
              <FilterSelect
                label="Term"
                value={termNumber == null ? '__all__' : String(termNumber)}
                onChange={(v) =>
                  setTermNumber(v === '__all__' ? null : Number(v))
                }
                options={[
                  { value: '__all__', label: 'All terms' },
                  ...(payload.terms ?? []).map((t) => ({
                    value: String(t.termNumber),
                    label: `Term ${t.termNumber}`,
                  })),
                ]}
              />
              <FilterSelect
                label="Subject"
                value={subjectId ?? '__all__'}
                onChange={(v) => setSubjectId(v === '__all__' ? null : v)}
                options={[
                  { value: '__all__', label: 'All subjects' },
                  ...(payload.subjects ?? []).map((s) => ({
                    value: s.id,
                    label: s.name,
                  })),
                ]}
              />
              <FilterSelect
                label="Status"
                value={status}
                onChange={(v) => setStatus(v as MasterfileStatusFilter)}
                options={STATUS_OPTIONS}
              />
            </>
          )}
        </div>

        <Button asChild variant="outline" size="sm" className="h-9">
          <a href={exportHref}>
            <FileSpreadsheet className="size-3.5" />
            Export to Excel
          </a>
        </Button>
      </div>

      {view === 'dashboard' ? (
        <MasterfileDashboard payload={payload} filters={filters} />
      ) : (
        <MasterfileGrid payload={payload} />
      )}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-all',
        active
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
