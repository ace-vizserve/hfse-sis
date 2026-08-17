'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type TermOption = { value: string; label: string; isCurrent: boolean };

type SheetReport = {
  sheet: string;
  sectionId: string | null;
  sectionName: string | null;
  dailyRowsWritten: number;
  studentsMatched: number;
  studentsUnmatched: Array<{ indexNumber: unknown; fullName: unknown }>;
  dateColumns: number;
  errors: string[];
};

type ImportResponse = {
  ok: boolean;
  dryRun: boolean;
  termId: string;
  sections: number;
  totalDailyWritten: number;
  totalStudentsMatched: number;
  reports: SheetReport[];
};

export function ImportAttendanceForm({
  termOptions,
  ayCode,
}: {
  termOptions: TermOption[];
  ayCode: string;
}) {
  const defaultTerm =
    termOptions.find((t) => t.isCurrent)?.value ?? termOptions[0]?.value ?? '';
  const [termId, setTermId] = useState(defaultTerm);
  const [dryRun, setDryRun] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  // A multipart upload — FormData passed straight to apiFetch (NO jsonInit /
  // content-type header, so the browser sets the multipart boundary). The
  // route-specific error copy is preserved via ApiError.message (body.error).
  const importMutation = useMutation({
    mutationFn: (formData: FormData) =>
      apiFetch<ImportResponse>('/api/attendance/import', {
        method: 'POST',
        body: formData,
      }),
  });

  const run = useWriteAction();
  const [submitting, setSubmitting] = useState(false);

  async function runImport(formData: FormData) {
    setSubmitting(true);
    await run(() => importMutation.mutateAsync(formData), {
      // A workbook of a whole term is the longest wait in the module.
      pending: dryRun ? 'Parsing the workbook…' : 'Importing attendance…',
      success: (ok) => {
        const totalErrors = ok.reports.reduce((n, r) => n + r.errors.length, 0);
        if (totalErrors > 0) {
          // It finished, but with sheet-level issues — that is a warning, not a
          // success, and it must not be recoloured into one.
          toast.warning(
            `${ok.dryRun ? 'Parse' : 'Import'} finished with ${totalErrors} sheet-level issue${
              totalErrors === 1 ? '' : 's'
            } — review the report below.`
          );
          return null;
        }
        return ok.dryRun
          ? `Dry run OK: ${ok.totalDailyWritten.toLocaleString('en-SG')} rows parsed across ${ok.sections} sheet${ok.sections === 1 ? '' : 's'}`
          : `Imported ${ok.totalDailyWritten.toLocaleString('en-SG')} rows across ${ok.sections} sheet${ok.sections === 1 ? '' : 's'}`;
      },
      error: (e) => (e instanceof Error ? e.message : 'import failed'),
      // The report renders from this component's own state, so it is ready
      // immediately either way.
      onResolved: (ok) => setResult(ok),
      // A dry run writes nothing, so there is no server state to re-read. A
      // real import changes the term's attendance and every rollup off it.
      refresh: (ok) => !ok.dryRun,
    });
    setSubmitting(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error('Pick a workbook first');
      return;
    }
    if (!termId) {
      toast.error('Select a term');
      return;
    }

    setResult(null);
    const formData = new FormData();
    formData.set('file', file);
    formData.set('termId', termId);
    formData.set('dryRun', String(dryRun));
    void runImport(formData);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="termId">
            Target term
            {ayCode && (
              <span className="ml-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {ayCode}
              </span>
            )}
          </Label>
          <Select
            value={termId}
            onValueChange={setTermId}
            disabled={submitting}
          >
            <SelectTrigger id="termId" className="h-10 w-full">
              <SelectValue placeholder="Select a term" />
            </SelectTrigger>
            <SelectContent>
              {termOptions.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                  {t.isCurrent && (
                    <span className="ml-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                      current
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="file">Workbook (.xlsx)</Label>
          <Input
            id="file"
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            disabled={submitting}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="cursor-pointer"
          />
          {file && (
            <p className="font-mono text-[11px] text-muted-foreground">
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-4">
        <Checkbox
          id="dryRun"
          checked={dryRun}
          onCheckedChange={(v) => setDryRun(v === true)}
          disabled={submitting}
        />
        <div className="flex-1">
          <Label htmlFor="dryRun" className="cursor-pointer font-medium">
            Dry run — parse &amp; report without writing
          </Label>
          <p className="text-[11px] text-muted-foreground">
            Leave this on for the first pass so you can confirm sheet→section
            matches and spot unmatched students before any rows land in the
            ledger.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          type="submit"
          loading={submitting}
          loadingText={dryRun ? 'Parsing…' : 'Importing…'}
          disabled={!file || !termId}
          className="gap-2"
        >
          {!submitting && <Upload className="size-4" />}
          {dryRun ? 'Run dry parse' : 'Import to ledger'}
        </Button>
      </div>

      {result && <ImportReport result={result} />}
    </form>
  );
}

function ImportReport({ result }: { result: ImportResponse }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border bg-card p-5">
        <ReportStat
          label="Sheets"
          value={result.sections.toLocaleString('en-SG')}
        />
        <ReportStat
          label="Students matched"
          value={result.totalStudentsMatched.toLocaleString('en-SG')}
        />
        <ReportStat
          label={result.dryRun ? 'Rows parsed' : 'Rows written'}
          value={result.totalDailyWritten.toLocaleString('en-SG')}
          highlight={!result.dryRun}
        />
        {result.dryRun && (
          <span className="ml-auto rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-200">
            Dry run · nothing written
          </span>
        )}
      </div>

      <div className="space-y-2">
        {result.reports.map((r) => (
          <div
            key={r.sheet}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {r.errors.length > 0 ? (
                  <AlertCircle className="size-4 text-destructive" />
                ) : (
                  <CheckCircle2 className="size-4 text-primary" />
                )}
                <span className="font-serif text-[15px] font-semibold tracking-tight text-foreground">
                  {r.sheet}
                </span>
                {r.sectionName && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    → {r.sectionName}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 font-mono text-[11px] tabular-nums text-muted-foreground">
                <span>{r.studentsMatched.toLocaleString('en-SG')} matched</span>
                <span>{r.dateColumns.toLocaleString('en-SG')} dates</span>
                <span className="text-foreground">
                  {r.dailyRowsWritten.toLocaleString('en-SG')} rows
                </span>
              </div>
            </div>
            {r.studentsUnmatched.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px]">
                <div className="mb-1 font-mono font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-200">
                  Unmatched students ({r.studentsUnmatched.length})
                </div>
                <ul className="space-y-0.5 text-muted-foreground">
                  {r.studentsUnmatched.slice(0, 10).map((u, idx) => (
                    <li key={idx}>
                      <span className="font-mono text-foreground">
                        {String(u.indexNumber ?? '—')}
                      </span>{' '}
                      — {String(u.fullName ?? '—')}
                    </li>
                  ))}
                  {r.studentsUnmatched.length > 10 && (
                    <li>… and {r.studentsUnmatched.length - 10} more</li>
                  )}
                </ul>
              </div>
            )}
            {r.errors.length > 0 && (
              <div className="mt-2 rounded-lg border border-destructive/30 bg-gradient-to-b from-destructive/10 to-destructive/0 p-3 text-[11px] text-destructive">
                {r.errors.map((e, idx) => (
                  <div key={idx}>{e}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span
        className={
          'font-serif text-[22px] font-semibold tabular-nums ' +
          (highlight ? 'text-primary' : 'text-foreground')
        }
      >
        {value}
      </span>
    </div>
  );
}
