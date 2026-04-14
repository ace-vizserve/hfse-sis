'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Row = {
  enrolment_id: string;
  index_number: number;
  withdrawn: boolean;
  student_number: string;
  student_name: string;
  school_days: number | null;
  days_present: number | null;
  days_late: number | null;
};

type Field = 'school_days' | 'days_present' | 'days_late';

export function AttendanceGrid({
  sectionId,
  termId,
  rows: initialRows,
}: {
  sectionId: string;
  termId: string;
  rows: Row[];
}) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  async function saveRow(row: Row) {
    setSavingId(row.enrolment_id);
    try {
      const res = await fetch(`/api/sections/${sectionId}/attendance`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          term_id: termId,
          section_student_id: row.enrolment_id,
          school_days: row.school_days,
          days_present: row.days_present,
          days_late: row.days_late,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'save failed');
      setSavedId(row.enrolment_id);
      setTimeout(() => setSavedId((id) => (id === row.enrolment_id ? null : id)), 1500);
    } catch (e) {
      toast.error(
        `Failed to save attendance for #${row.index_number} ${row.student_name}: ${e instanceof Error ? e.message : 'error'}`,
      );
    } finally {
      setSavingId((s) => (s === row.enrolment_id ? null : s));
    }
  }

  function update(enrolmentId: string, field: Field, raw: string) {
    const v = raw === '' ? null : Number(raw);
    setRows((current) =>
      current.map((r) => (r.enrolment_id === enrolmentId ? { ...r, [field]: v } : r)),
    );
  }

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-14 text-right">#</TableHead>
              <TableHead>Student</TableHead>
              <TableHead className="w-[140px] text-right">School days</TableHead>
              <TableHead className="w-[140px] text-right">Present</TableHead>
              <TableHead className="w-[140px] text-right">Late</TableHead>
              <TableHead className="w-10" aria-label="Save state" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="font-serif text-base font-semibold text-foreground">
                      No students enrolled
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Sync from admissions or add a student to this section first.
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const disabled = r.withdrawn;
              const saving = savingId === r.enrolment_id;
              const justSaved = savedId === r.enrolment_id;
              return (
                <TableRow
                  key={r.enrolment_id}
                  className={disabled ? 'text-muted-foreground' : ''}
                >
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {r.index_number}
                  </TableCell>
                  <TableCell>
                    <div
                      className={
                        'font-medium ' +
                        (disabled ? 'line-through text-muted-foreground' : 'text-foreground')
                      }
                    >
                      {r.student_name}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {r.student_number}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <NumInput
                      value={r.school_days}
                      disabled={disabled}
                      onChange={(v) => update(r.enrolment_id, 'school_days', v)}
                      onCommit={() =>
                        saveRow(rows.find((x) => x.enrolment_id === r.enrolment_id)!)
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <NumInput
                      value={r.days_present}
                      disabled={disabled}
                      onChange={(v) => update(r.enrolment_id, 'days_present', v)}
                      onCommit={() =>
                        saveRow(rows.find((x) => x.enrolment_id === r.enrolment_id)!)
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <NumInput
                      value={r.days_late}
                      disabled={disabled}
                      onChange={(v) => update(r.enrolment_id, 'days_late', v)}
                      onCommit={() =>
                        saveRow(rows.find((x) => x.enrolment_id === r.enrolment_id)!)
                      }
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    {saving ? (
                      <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : justSaved ? (
                      <CheckCircle2 className="mx-auto h-3.5 w-3.5 text-primary" />
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function NumInput({
  value,
  disabled,
  onChange,
  onCommit,
}: {
  value: number | null;
  disabled?: boolean;
  onChange: (raw: string) => void;
  onCommit: () => void;
}) {
  const [text, setText] = useState<string>(value == null ? '' : String(value));
  return (
    <Input
      type="number"
      min={0}
      disabled={disabled}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
      onBlur={onCommit}
      className="ml-auto h-9 w-24 text-right font-mono tabular-nums disabled:cursor-not-allowed disabled:bg-muted/40"
    />
  );
}
