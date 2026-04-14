'use client';

import { useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type GradeRow = {
  entry_id: string;
  index_number: number;
  student_name: string;
  student_number: string;
  withdrawn: boolean;
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [approvalRef, setApprovalRef] = useState<string>('');

  const patchEntry = useCallback(
    async (entryId: string, body: Partial<Pick<GradeRow, 'ww_scores' | 'pt_scores' | 'qa_score'>>) => {
      let approval = approvalRef;
      if (requireApproval && !approval) {
        const entered = window.prompt(
          'This sheet is locked. Enter the approval reference (e.g. "Email from Ms. Chandana, 2026-03-15"):',
          '',
        );
        if (!entered || !entered.trim()) {
          setErrors((e) => ({ ...e, [entryId]: 'approval reference required' }));
          return;
        }
        approval = entered.trim();
        setApprovalRef(approval);
      }

      setSavingId(entryId);
      setErrors((e) => {
        const n = { ...e };
        delete n[entryId];
        return n;
      });
      try {
        const payload = requireApproval ? { ...body, approval_reference: approval } : body;
        const res = await fetch(`/api/grading-sheets/${sheetId}/entries/${entryId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          setErrors((e) => ({ ...e, [entryId]: data.error ?? 'save failed' }));
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
                }
              : r,
          ),
        );
      } catch (e) {
        setErrors((er) => ({ ...er, [entryId]: e instanceof Error ? e.message : 'error' }));
      } finally {
        setSavingId(null);
      }
    },
    [sheetId, requireApproval, approvalRef],
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const disabled = r.withdrawn || readOnly;
              const rowClass = disabled ? 'text-muted-foreground' : '';
              return (
                <TableRow key={r.entry_id} className={rowClass}>
                  <TableCell className="sticky left-0 z-10 bg-card text-right tabular-nums">
                    {r.index_number}
                  </TableCell>
                  <TableCell className="sticky left-8 z-10 bg-card">
                    <div className="whitespace-nowrap">{r.student_name}</div>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      {r.student_number}
                    </div>
                  </TableCell>

                  {wwTotals.map((_, i) => (
                    <TableCell key={`ww-${i}`} className="px-1 py-1">
                      <ScoreInput
                        value={r.ww_scores[i] ?? null}
                        disabled={disabled}
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

                  {ptTotals.map((_, i) => (
                    <TableCell key={`pt-${i}`} className="px-1 py-1">
                      <ScoreInput
                        value={r.pt_scores[i] ?? null}
                        disabled={disabled}
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
                      disabled={disabled}
                      onLocalChange={(v) =>
                        updateLocal(r.entry_id, (row) => ({ ...row, qa_score: v }))
                      }
                      onCommit={(v) => patchEntry(r.entry_id, { qa_score: v })}
                    />
                  </TableCell>

                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.initial_grade != null ? r.initial_grade.toFixed(2) : '—'}
                  </TableCell>
                  <TableCell className="text-right text-base font-semibold tabular-nums">
                    {r.quarterly_grade ?? '—'}
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

      {Object.entries(errors).length > 0 && (
        <Alert variant="destructive">
          <AlertDescription className="space-y-1">
            {Object.entries(errors).map(([id, msg]) => {
              const row = rows.find((r) => r.entry_id === id);
              return (
                <div key={id}>
                  #{row?.index_number} {row?.student_name}: {msg}
                </div>
              );
            })}
          </AlertDescription>
        </Alert>
      )}
    </div>
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
  disabled,
  onLocalChange,
  onCommit,
}: {
  value: number | null;
  disabled?: boolean;
  onLocalChange: (v: number | null) => void;
  onCommit: (v: number | null) => void;
}) {
  const [text, setText] = useState<string>(displayCell(value));

  return (
    <input
      type="number"
      inputMode="decimal"
      disabled={disabled}
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
      className="h-8 w-14 rounded-md border border-input bg-background px-1.5 text-right text-sm tabular-nums ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60"
    />
  );
}
