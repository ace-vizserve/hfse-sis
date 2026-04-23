'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type ChecklistItem = {
  id: string;
  item_text: string;
  sort_order: number;
};

type RosterStudent = {
  section_student_id: string;
  student_id: string;
  index_number: number;
  student_number: string;
  student_name: string;
};

type SubjectOption = { id: string; code: string; name: string };

type ChecklistState = {
  // key = `${studentId}|${itemId}` → checked
  responses: Map<string, boolean>;
  // key = studentId → current comment text
  comments: Map<string, string>;
  // key = studentId → 'idle' | 'saving' | 'saved'
  commentStatus: Map<string, 'idle' | 'saving' | 'saved'>;
};

const COMMENT_DEBOUNCE_MS = 800;

// Subject-teacher (and form_adviser / registrar+) tick UI. One column per
// checklist item, one row per student, plus a per-student "Comment" block
// that writes to `evaluation_subject_comments`. Autosaves on every tick /
// keystroke (debounced for comments).
export function ChecklistRosterClient({
  termId,
  sectionId,
  subjects,
  initialSubjectId,
  items,
  roster,
  initialResponses,
  initialComments,
  canEdit,
}: {
  termId: string;
  sectionId: string;
  subjects: SubjectOption[];
  initialSubjectId: string;
  items: ChecklistItem[];
  roster: RosterStudent[];
  initialResponses: Map<string, boolean>;
  initialComments: Map<string, string>;
  canEdit: boolean;
}) {
  const [subjectId, setSubjectId] = useState(initialSubjectId);

  const [state, setState] = useState<ChecklistState>(() => ({
    responses: new Map(initialResponses),
    comments: new Map(initialComments),
    commentStatus: new Map(),
  }));

  const commentTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const saveResponse = useCallback(
    async (studentId: string, itemId: string, isChecked: boolean) => {
      try {
        const res = await fetch('/api/evaluation/checklist-responses', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            termId,
            sectionId,
            studentId,
            checklistItemId: itemId,
            isChecked,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? 'save failed');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'save failed');
        // Revert optimistic tick on failure.
        setState((prev) => {
          const next = new Map(prev.responses);
          next.set(`${studentId}|${itemId}`, !isChecked);
          return { ...prev, responses: next };
        });
      }
    },
    [termId, sectionId],
  );

  const saveComment = useCallback(
    async (studentId: string, comment: string) => {
      setState((prev) => {
        const s = new Map(prev.commentStatus);
        s.set(studentId, 'saving');
        return { ...prev, commentStatus: s };
      });
      try {
        const res = await fetch('/api/evaluation/subject-comments', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            termId,
            sectionId,
            studentId,
            subjectId,
            comment: comment || null,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? 'save failed');
        setState((prev) => {
          const s = new Map(prev.commentStatus);
          s.set(studentId, 'saved');
          return { ...prev, commentStatus: s };
        });
        setTimeout(() => {
          setState((prev) => {
            const s = new Map(prev.commentStatus);
            if (s.get(studentId) === 'saved') s.set(studentId, 'idle');
            return { ...prev, commentStatus: s };
          });
        }, 1500);
      } catch (e) {
        setState((prev) => {
          const s = new Map(prev.commentStatus);
          s.set(studentId, 'idle');
          return { ...prev, commentStatus: s };
        });
        toast.error(e instanceof Error ? e.message : 'save failed');
      }
    },
    [termId, sectionId, subjectId],
  );

  function handleTick(studentId: string, itemId: string, nextChecked: boolean) {
    setState((prev) => {
      const next = new Map(prev.responses);
      next.set(`${studentId}|${itemId}`, nextChecked);
      return { ...prev, responses: next };
    });
    void saveResponse(studentId, itemId, nextChecked);
  }

  function handleCommentChange(studentId: string, next: string) {
    setState((prev) => {
      const c = new Map(prev.comments);
      c.set(studentId, next);
      return { ...prev, comments: c };
    });

    const existing = commentTimers.current.get(studentId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      commentTimers.current.delete(studentId);
      void saveComment(studentId, next);
    }, COMMENT_DEBOUNCE_MS);
    commentTimers.current.set(studentId, t);
  }

  // Subject-switching reloads via a full URL update (the page RSC re-fetches
  // items + responses + comments for the new subject).
  function switchSubject(next: string) {
    if (next === subjectId) return;
    setSubjectId(next);
    const qs = new URLSearchParams(window.location.search);
    qs.set('subject_id', next);
    qs.set('tab', 'checklists');
    window.location.search = qs.toString();
  }

  const tickedPerStudent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [key, checked] of state.responses.entries()) {
      if (!checked) continue;
      const [studentId] = key.split('|');
      const belongsToCurrentItems = items.some(
        (i) => `${studentId}|${i.id}` === key,
      );
      if (!belongsToCurrentItems) continue;
      counts.set(studentId, (counts.get(studentId) ?? 0) + 1);
    }
    return counts;
  }, [state.responses, items]);

  const totalItems = items.length;

  return (
    <div className="space-y-5">
      {/* Subject picker */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label
            htmlFor="subject-picker"
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Subject
          </label>
          <Select value={subjectId} onValueChange={switchSubject}>
            <SelectTrigger id="subject-picker" className="h-10 w-[260px]">
              <SelectValue placeholder="Pick a subject" />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">{s.code}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {totalItems} topic{totalItems === 1 ? '' : 's'} · {roster.length} student
          {roster.length === 1 ? '' : 's'}
        </div>
      </div>

      {totalItems === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          No topics configured for this subject × level × term. Ask the superadmin to seed them in{' '}
          <span className="whitespace-nowrap font-mono text-[11px]">SIS Admin → Eval Checklists</span>
          .
        </div>
      ) : roster.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          No students on the roster.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {roster.map((student) => {
            const ticked = tickedPerStudent.get(student.student_id) ?? 0;
            const comment = state.comments.get(student.student_id) ?? '';
            const status = state.commentStatus.get(student.student_id) ?? 'idle';
            return (
              <li key={student.student_id} className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[240px_1fr]">
                {/* Student identity */}
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
                      #{student.index_number}
                    </span>
                    <span className="font-serif text-[14px] font-semibold leading-snug tracking-tight text-foreground">
                      {student.student_name}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {student.student_number}
                  </div>
                  <Badge
                    variant="outline"
                    className="mt-2 font-mono text-[10px] tabular-nums"
                  >
                    {ticked} / {totalItems} ticked
                  </Badge>
                </div>

                {/* Checklist + comment */}
                <div className="min-w-0 space-y-3">
                  <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {items.map((item) => {
                      const key = `${student.student_id}|${item.id}`;
                      const checked = state.responses.get(key) ?? false;
                      return (
                        <li
                          key={item.id}
                          className="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-2 py-1.5 text-[12px]"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!canEdit}
                            onChange={(e) =>
                              handleTick(student.student_id, item.id, e.target.checked)
                            }
                            className="mt-0.5 size-3.5 cursor-pointer accent-primary"
                          />
                          <span className="min-w-0 flex-1 leading-snug">{item.item_text}</span>
                        </li>
                      );
                    })}
                  </ul>

                  <div>
                    <div className="flex items-baseline justify-between">
                      <label
                        htmlFor={`comment-${student.student_id}`}
                        className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                      >
                        Comments if any
                      </label>
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                        {status === 'saving' && <>Saving…</>}
                        {status === 'saved' && (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <Check className="size-3" /> Saved
                          </span>
                        )}
                        {comment.length > 0 && status === 'idle' && (
                          <>{comment.length} chars</>
                        )}
                      </span>
                    </div>
                    <textarea
                      id={`comment-${student.student_id}`}
                      value={comment}
                      disabled={!canEdit}
                      onChange={(e) => handleCommentChange(student.student_id, e.target.value)}
                      rows={2}
                      placeholder={
                        canEdit
                          ? 'Per-subject comment (optional). PTC use only — does not print on the report card.'
                          : 'Read-only.'
                      }
                      className="mt-1 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-70"
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
