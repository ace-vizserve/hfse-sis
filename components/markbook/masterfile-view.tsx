'use client';

import { ChevronDown, FileSpreadsheet } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MasterfileDashboard } from '@/components/markbook/masterfile-dashboard';
import type {
  MasterfileDashboardFilters,
  MasterfileStatusFilter,
} from '@/lib/markbook/masterfile-dashboard';
import type { MasterfilePayload } from '@/lib/markbook/masterfile';

// Masterfile surface shell (KD #95 / KD #122 / KD #127). The on-screen grid
// has been demoted to an export-only artifact (Task 11). Always renders the
// MasterfileDashboard. The toolbar holds the Term / Subject / Status refinement
// filters (all client-side over the in-memory payload) and a "Generate
// Masterfile" dropdown that downloads the full sheet as Excel or CSV.

const STATUS_OPTIONS: Array<{ value: MasterfileStatusFilter; label: string }> =
  [
    { value: 'all', label: 'All statuses' },
    { value: 'active', label: 'Active only' },
    { value: 'late_enrollee', label: 'Late enrolment' },
    { value: 'withdrawn', label: 'Withdrawn' },
  ];

export function MasterfileView({ payload }: { payload: MasterfilePayload }) {
  const [termNumber, setTermNumber] = useState<number | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [status, setStatus] = useState<MasterfileStatusFilter>('all');

  const filters: MasterfileDashboardFilters = useMemo(
    () => ({ termNumber, status, subjectId }),
    [termNumber, status, subjectId]
  );

  // Export base link mirrors the current ?ay / ?level / ?class scope.
  // The dashboard refinement filters (term / subject / status) intentionally
  // don't narrow the export — the workbook always shows the full masterfile.
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
      {/* Toolbar — dashboard filters + generate masterfile dropdown */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect
            label="Term"
            value={termNumber == null ? '__all__' : String(termNumber)}
            onChange={(v) => setTermNumber(v === '__all__' ? null : Number(v))}
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
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <FileSpreadsheet className="size-3.5" />
              Generate Masterfile
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={exportHref} download>
                <FileSpreadsheet className="size-3.5" />
                Excel (.xlsx)
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`${exportHref}&format=csv`} download>
                <FileSpreadsheet className="size-3.5" />
                CSV (.csv)
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <MasterfileDashboard payload={payload} filters={filters} />
    </div>
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
