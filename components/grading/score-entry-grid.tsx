'use client';

import { useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApprovalReference } from './use-approval-reference';

export type GradeRow = {
  entry_id: string;
  index_number: number;
  student_name: string;
  student_number: string;
  withdrawn: boolean;
  is_na: boolean;
  ww_scores: (number | null)[];
  pt_scores: (number | null)[];
  qa_score: number | null;
  ww_ps: number | null;
  pt_ps: number | null;
  qa_ps: number | null;
  initial_grade: number | null;
  quarterly_grade: number | null;
  letter_grade: string | null;
};

type Props = {
  sheetId: string;
  wwTotals: number[];
  ptTotals: number[];
  qaTotal: number | null;
  rows: GradeRow[];
  readOnly?: boolean;
  requireApproval?: boolean;
};

function parseCell(raw: string): number | null {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function displayCell(v: number | null): string {
  return v == null ? '' : String(v);
}

export function ScoreEntryGrid({
  sheetId,
  wwTotals,
  ptTotals,
  qaTotal,
  rows: initialRows,
  readOnly = false,
  requireApproval = false,
}: Props) {
  const [rows, setRows] = useState<GradeRow[]>(initialRows);
  const [savingId, setSavingId] = useState<string | null>(null);
  const {
    requireApproval: getApprovalRef,
    dialog: approvalDialog,
  } = useApprovalReference();
  const [approvalRef, setApprovalRef] = useState<string>('');

  const locked = readOnly && !requireApproval;

  const patchEntry = useCallback(
    async (entryId: string, body: Partial<Pick<GradeRow, 'ww_scores' | 'pt_scores' | 'qa_score' | 'is_na'>>) => {
      let approval = approvalRef;
      if (requireApproval && !approval) {
        const entered = await getApprovalRef();
        if (!entered) {
          toast.error('Approval reference required');
          return;
        }
        approval = entered;
        setApprovalRef(approval);
      }

      setSavingId(entryId);
      try {
        const payload = requireApproval ? { ...body, approval_reference: approval } : body;
        const res = await fetch(`/api/grading-sheets/${sheetId}/entries/${entryId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          const row = rows.find((r) => r.entry_id === entryId);
          toast.error(
            `Failed to save ${row ? `#${row.index_number} ${row.student_name}` : 'entry'}: ${data.error ?? 'save failed'}`,
          );
          return;
        }
        setRows((current) =>
          current.map((r) =>
            r.entry_id === entryId
              ? {
                  ...r,
                  ww_scores: data.entry.ww_scores ?? r.ww_scores,
                  pt_scores: data.entry.pt_scores ?? r.pt_scores,
                  qa_score: data.entry.qa_score,
                  ww_ps: data.entry.ww_ps,
                  pt_ps: data.entry.pt_ps,
                  qa_ps: data.entry.qa_ps,
                  initial_grade: data.entry.initial_grade,
                  quarterly_grade: data.entry.quarterly_grade,
                  is_na: data.entry.is_na ?? r.is_na,
                }
              : r,
          ),
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to save entry');
      } finally {
        setSavingId(null);
      }
    },
    [sheetId, requireApproval, approvalRef, getApprovalRef, rows],
  );

  const updateLocal = useCallback(
    (entryId: string, patch: (row: GradeRow) => GradeRow) => {
      setRows((current) => current.map((r) => (r.entry_id === entryId ? patch(r) : r)));
    },
    [],
  );

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="sticky left-0 z-10 bg-muted/40 text-right">#</TableHead>
              <TableHead className="sticky left-8 z-10 bg-muted/40">Student</TableHead>
              {wwTotals.map((max, i) => (
                <TableHead key={`ww-${i}`} className="text-center">
                  W{i + 1}
                  <sup className="ml-0.5 text-muted-foreground">/{max}</sup>
                </TableHead>
              ))}
              {ptTotals.map((max, i) => (
                <TableHead key={`pt-${i}`} className="text-center">
                  PT{i + 1}
                  <sup className="ml-0.5 text-muted-foreground">/{max}</sup>
                </TableHead>
              ))}
              <TableHead className="text-center">
                QA
                {qaTotal != null && (
                  <sup className="ml-0.5 text-muted-foreground">/{qaTotal}</sup>
                )}
              </TableHead>
              <TableHead className="text-right">Initial</TableHead>
              <TableHead className="text-right">Quarterly</TableHead>
              <TableHead className="text-center">N/A</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const inputsDisabled = r.withdrawn || r.is_na || readOnly;
              const muted = r.withdrawn || r.is_na || readOnly;
              const rowClass = muted ? 'text-muted-foreground' : '';
              return (
                <TableRow key={r.entry_id} className={rowClass}>
                  <TableCell className="sticky left-0 z-10 bg-card text-right tabular-nums">
                    {r.index_number}
                  </TableCell>
                  <TableCell className="sticky left-8 z-10 bg-card">
                    <div
                      className={
                        r.withdrawn
                          ? 'whitespace-nowrap line-through'
                          : 'whitespace-nowrap'
                      }
                    >
                      {r.student_name}
                    </div>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      {r.student_number}
                    </div>
                  </TableCell>

                  {wwTotals.map((max, i) => (
                    <TableCell key={`ww-${i}`} className="px-1 py-1">
                      <ScoreInput
                        value={r.ww_scores[i] ?? null}
                        max={max}
                        plaintext={locked}
                        disabled={inputsDisabled}
                        onLocalChange={(v) =>
                          updateLocal(r.entry_id, (row) => ({
                            ...row,
                            ww_scores: replaceAt(row.ww_scores, i, v, wwTotals.length),
                          }))
                        }
                        onCommit={(v) => {
                          const next = replaceAt(r.ww_scores, i, v, wwTotals.length);
                          patchEntry(r.entry_id, { ww_scores: next });
                        }}
                      />
                    </TableCell>
                  ))}

                  {ptTotals.map((max, i) => (
                    <TableCell key={`pt-${i}`} className="px-1 py-1">
                      <ScoreInput
                        value={r.pt_scores[i] ?? null}
                        max={max}
                        plaintext={locked}
                        disabled={inputsDisabled}
                        onLocalChange={(v) =>
                          updateLocal(r.entry_id, (row) => ({
                            ...row,
                            pt_scores: replaceAt(row.pt_scores, i, v, ptTotals.length),
                          }))
                        }
                        onCommit={(v) => {
                          const next = replaceAt(r.pt_scores, i, v, ptTotals.length);
                          patchEntry(r.entry_id, { pt_scores: next });
                        }}
                      />
                    </TableCell>
                  ))}

                  <TableCell className="px-1 py-1">
                    <ScoreInput
                      value={r.qa_score}
                      max={qaTotal}
                      plaintext={locked}
                      disabled={inputsDisabled}
                      onLocalChange={(v) =>
                        updateLocal(r.entry_id, (row) => ({ ...row, qa_score: v }))
                      }
                      onCommit={(v) => patchEntry(r.entry_id, { qa_score: v })}
                    />
                  </TableCell>

                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.initial_grade != null ? r.initial_grade.toFixed(2) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <QuarterlyPill value={r.quarterly_grade} muted={muted} />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={r.is_na}
                      disabled={r.withdrawn || readOnly}
                      aria-label="Mark late enrollee N/A"
                      onCheckedChange={(v) => {
                        const next = v === true;
                        updateLocal(r.entry_id, (row) => ({ ...row, is_na: next }));
                        patchEntry(r.entry_id, { is_na: next });
                      }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {savingId && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            saving…
          </span>
        )}
        {requireApproval && approvalRef && (
          <span>
            approval: <em className="font-medium">{approvalRef}</em>{' '}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0 text-xs font-normal"
              onClick={() => setApprovalRef('')}
            >
              change
            </Button>
          </span>
        )}
      </div>

      {approvalDialog}
    </div>
  );
}

function QuarterlyPill({ value, muted }: { value: number | null; muted: boolean }) {
  if (value == null) {
    return <span className="text-base font-semibold text-muted-foreground">—</span>;
  }
  if (muted) {
    return (
      <span className="text-base font-semibold tabular-nums text-muted-foreground">
        {value}
      </span>
    );
  }
  const tone =
    value < 75
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : value < 85
        ? 'border-hairline bg-muted text-ink'
        : 'border-brand-mint bg-brand-mint/30 text-ink';
  return (
    <Badge
      variant="outline"
      className={`h-7 justify-end px-2 text-sm font-semibold tabular-nums ${tone}`}
    >
      {value}
    </Badge>
  );
}

function replaceAt(
  arr: (number | null)[],
  i: number,
  v: number | null,
  length: number,
): (number | null)[] {
  const out = new Array<number | null>(length).fill(null);
  for (let k = 0; k < length; k++) out[k] = arr[k] ?? null;
  out[i] = v;
  return out;
}

function ScoreInput({
  value,
  max,
  disabled,
  plaintext,
  onLocalChange,
  onCommit,
}: {
  value: number | null;
  max?: number | null;
  disabled?: boolean;
  plaintext?: boolean;
  onLocalChange: (v: number | null) => void;
  onCommit: (v: number | null) => void;
}) {
  const [text, setText] = useState<string>(displayCell(value));

  if (plaintext) {
    return (
      <span className="inline-block h-8 w-14 px-1.5 py-1 text-right text-sm tabular-nums text-ink">
        {displayCell(value) || '—'}
      </span>
    );
  }

  const parsed = parseCell(text);
  const isExceeded = parsed != null && max != null && parsed > max;

  return (
    <input
      type="number"
      inputMode="decimal"
      disabled={disabled}
      aria-invalid={isExceeded || undefined}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onLocalChange(parseCell(e.target.value));
      }}
      onBlur={() => {
        onCommit(parseCell(text));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="h-8 w-14 rounded-md border border-input bg-background px-1.5 text-right text-sm tabular-nums ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-[invalid=true]:border-destructive aria-[invalid=true]:bg-destructive/5 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/20"
    />
  );
}
