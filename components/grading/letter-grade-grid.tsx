'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { GradeRow } from './score-entry-grid';
import { useApprovalReference } from './use-approval-reference';

const LETTER_OPTIONS = ['A', 'B', 'C', 'IP', 'UG', 'NA', 'INC', 'CO', 'E'] as const;
const EMPTY_LETTER = '__none__';

export function LetterGradeGrid({
  sheetId,
  rows: initialRows,
  readOnly = false,
  requireApproval = false,
}: {
  sheetId: string;
  rows: GradeRow[];
  readOnly?: boolean;
  requireApproval?: boolean;
}) {
  const [rows, setRows] = useState<GradeRow[]>(initialRows);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [approvalRef, setApprovalRef] = useState<string>('');
  const {
    requireApproval: getApprovalRef,
    dialog: approvalDialog,
  } = useApprovalReference();

  async function save(entryId: string, letter: string | null) {
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
      const payload = requireApproval
        ? { letter_grade: letter, approval_reference: approval }
        : { letter_grade: letter };
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
        current.map((r) => (r.entry_id === entryId ? { ...r, letter_grade: letter } : r)),
      );
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-12 text-right">#</TableHead>
              <TableHead>Student</TableHead>
              <TableHead className="w-40">Letter grade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const plaintext = readOnly && !requireApproval;
              const disabled = r.withdrawn || readOnly;
              return (
                <TableRow key={r.entry_id} className={disabled ? 'text-muted-foreground' : ''}>
                  <TableCell className="text-right tabular-nums">{r.index_number}</TableCell>
                  <TableCell>
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
                  <TableCell>
                    {plaintext ? (
                      <span className="inline-block text-sm tabular-nums text-ink">
                        {r.letter_grade ?? '—'}
                      </span>
                    ) : (
                      <Select
                        disabled={disabled}
                        value={r.letter_grade ?? EMPTY_LETTER}
                        onValueChange={(v) =>
                          save(r.entry_id, v === EMPTY_LETTER ? null : v)
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EMPTY_LETTER}>—</SelectItem>
                          {LETTER_OPTIONS.map((o) => (
                            <SelectItem key={o} value={o}>
                              {o}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {savingId && (
        <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          saving…
        </div>
      )}

      {approvalDialog}
    </div>
  );
}
