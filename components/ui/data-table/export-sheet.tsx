'use client';

import { useEffect, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { exportCsv } from './csv';
import {
  buildScreenFields,
  fieldsToCsvColumns,
  type ExportField,
} from './export-payload';
import { humanizeFieldName } from './humanize-field';
import type { CsvConfig } from './types';

const SCREEN_OPTION = 'screen';

export type DataTableExportSheetProps<TRow> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rows in the CURRENT scope — already filtered, sorted and
   *  selection-narrowed by the shell. The sheet never re-filters. */
  rows: TRow[];
  columns: ColumnDef<TRow>[];
  visibleColumnIds: string[];
  csv: CsvConfig<TRow>;
};

export function DataTableExportSheet<TRow>({
  open,
  onOpenChange,
  rows,
  columns,
  visibleColumnIds,
  csv,
}: DataTableExportSheetProps<TRow>) {
  const [choice, setChoice] = useState<string>(SCREEN_OPTION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed on each open so a previous run's choice never silently applies
  // to a different scope.
  useEffect(() => {
    if (open) {
      setChoice(SCREEN_OPTION);
      setError(null);
    }
  }, [open]);

  const presets = csv.rawColumns?.exportPresets ?? [];

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      let fields: ExportField<TRow>[];
      if (choice === SCREEN_OPTION) {
        fields = buildScreenFields(
          columns,
          visibleColumnIds,
          csv.extraColumns,
          rows
        );
      } else {
        const cfg = csv.rawColumns;
        const preset = presets.find((p) => p.id === choice);
        if (!cfg || !preset) return;
        const keys = rows.map(cfg.keyOf);
        // Load each source the preset names, in declared order, so the
        // column order in the file follows the preset rather than whichever
        // request resolved first.
        // Two sources can share a column name (`enroleeNumber` exists on
        // both admissions tables), which would emit a duplicate CSV header.
        // Suffix with the source label only when a preset spans more than
        // one source, so single-source exports stay clean.
        const disambiguate = preset.sourceIds.length > 1;
        const loaded = await Promise.all(
          preset.sourceIds.map(async (sourceId) => {
            const source = cfg.sources.find((s) => s.id === sourceId);
            if (!source) return [];
            const data = await source.fetch(keys);
            // Drop object-valued columns (e.g. residenceHistory) — a JSON
            // blob in a spreadsheet cell helps nobody. Probe the first
            // non-null value per column name.
            const colNames = Array.from(
              new Set(Object.values(data).flatMap((r) => Object.keys(r)))
            ).filter((col) => {
              const sample = Object.values(data)
                .map((r) => r[col])
                .find((v) => v != null);
              return typeof sample !== 'object';
            });
            return colNames.map((col) => ({
              id: `raw:${sourceId}:${col}`,
              header: disambiguate
                ? `${humanizeFieldName(col)} (${source.label})`
                : humanizeFieldName(col),
              accessor: (row: TRow): string | number | null => {
                const v = data[cfg.keyOf(row)]?.[col];
                if (v == null) return null;
                if (typeof v === 'boolean') return v ? 'Yes' : 'No';
                if (typeof v === 'object') return JSON.stringify(v);
                return v as string | number;
              },
            }));
          })
        );
        fields = loaded.flat();
      }
      exportCsv(rows, fieldsToCsvColumns(rows, fields), csv.filename);
      onOpenChange(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not build the export. Try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Export CSV</SheetTitle>
          <SheetDescription>
            {rows.length} rows will be exported, matching the filters on screen.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-5">
          <RadioGroup
            value={choice}
            onValueChange={setChoice}
            className="gap-3"
          >
            <div className="flex items-start gap-3">
              <RadioGroupItem
                value={SCREEN_OPTION}
                id="export-screen"
                className="mt-0.5"
              />
              <Label
                htmlFor="export-screen"
                className="flex-1 cursor-pointer font-normal"
              >
                <span className="block font-medium text-foreground">
                  What&apos;s on screen
                </span>
                <span className="block text-xs text-muted-foreground">
                  The columns this table is showing right now. Use the Columns
                  menu first if you want more.
                </span>
              </Label>
            </div>
            {presets.map((p) => (
              <div key={p.id} className="flex items-start gap-3">
                <RadioGroupItem
                  value={p.id}
                  id={`export-${p.id}`}
                  className="mt-0.5"
                />
                <Label
                  htmlFor={`export-${p.id}`}
                  className="flex-1 cursor-pointer font-normal"
                >
                  <span className="block font-medium text-foreground">
                    {p.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Every stored field, not just what fits on screen.
                  </span>
                </Label>
              </div>
            ))}
          </RadioGroup>

          {error && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <SheetFooter>
          <Button onClick={handleDownload} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 size-3.5" />
            )}
            Download
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
