'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

type Row = {
  enrolment_id: string;
  index_number: number;
  withdrawn: boolean;
  student_id: string;
  student_number: string;
  student_name: string;
  comment: string | null;
};

export function CommentsGrid({
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

  async function save(row: Row, nextComment: string) {
    if ((row.comment ?? '') === nextComment) return;
    setSavingId(row.student_id);
    try {
      const res = await fetch(`/api/sections/${sectionId}/comments`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          term_id: termId,
          student_id: row.student_id,
          comment: nextComment || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'save failed');
      setRows((current) =>
        current.map((r) =>
          r.student_id === row.student_id ? { ...r, comment: nextComment || null } : r,
        ),
      );
      setSavedId(row.student_id);
      setTimeout(() => setSavedId((id) => (id === row.student_id ? null : id)), 1500);
    } catch (e) {
      toast.error(
        `Failed to save comment for #${row.index_number} ${row.student_name}: ${e instanceof Error ? e.message : 'error'}`,
      );
    } finally {
      setSavingId((s) => (s === row.student_id ? null : s));
    }
  }

  if (rows.length === 0) {
    return (
      <Card className="items-center py-12 text-center">
        <CardContent className="flex flex-col items-center gap-3">
          <div className="font-serif text-lg font-semibold text-foreground">
            No students enrolled
          </div>
          <div className="text-sm text-muted-foreground">
            Sync from admissions or add a student to this section first.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((r) => {
        const saving = savingId === r.student_id;
        const justSaved = savedId === r.student_id;
        const hasComment = !!(r.comment && r.comment.trim().length > 0);
        return (
          <Card key={r.enrolment_id} className="@container/card">
            <CardHeader>
              <CardDescription className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                <span className="tabular-nums">#{r.index_number}</span>
                <span className="text-hairline-strong">·</span>
                <span className="tabular-nums">{r.student_number}</span>
              </CardDescription>
              <CardTitle
                className={
                  'font-serif text-xl font-semibold leading-snug tracking-tight ' +
                  (r.withdrawn ? 'line-through text-muted-foreground' : 'text-foreground')
                }
              >
                {r.student_name}
              </CardTitle>
              <CardAction>
                {r.withdrawn ? (
                  <Badge
                    variant="outline"
                    className="h-6 border-destructive/40 bg-destructive/10 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-destructive"
                  >
                    Withdrawn
                  </Badge>
                ) : hasComment ? (
                  <Badge
                    variant="outline"
                    className="h-6 border-brand-mint bg-brand-mint/30 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Written
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="h-6 border-brand-indigo-soft/60 bg-accent px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-indigo-deep"
                  >
                    Pending
                  </Badge>
                )}
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-2">
              <CommentTextarea
                initial={r.comment ?? ''}
                disabled={r.withdrawn}
                onCommit={(v) => save(r, v)}
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {saving && (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Saving…
                    </span>
                  )}
                  {justSaved && !saving && (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <CheckCircle2 className="h-3 w-3" />
                      Saved
                    </span>
                  )}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function CommentTextarea({
  initial,
  disabled,
  onCommit,
}: {
  initial: string;
  disabled?: boolean;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <Textarea
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text.trim())}
      rows={3}
      placeholder="Write adviser's comment for this term…"
      className="min-h-[84px] resize-y disabled:cursor-not-allowed disabled:bg-muted/40"
    />
  );
}
