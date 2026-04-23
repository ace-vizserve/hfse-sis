'use client';

import { useCallback, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';

type RosterStudent = {
  student_id: string;
  index_number: number;
  student_number: string;
  student_name: string;
};

const DEBOUNCE_MS = 800;

// Registrar / school_admin PTC feedback capture. One textarea per student;
// autosaves on debounced keystroke to evaluation_ptc_feedback. Never flows
// to the report card (KD #49).
export function PtcRosterClient({
  termId,
  sectionId,
  roster,
  initialFeedback,
}: {
  termId: string;
  sectionId: string;
  roster: RosterStudent[];
  initialFeedback: Map<string, string>;
}) {
  const [feedback, setFeedback] = useState<Map<string, string>>(() => new Map(initialFeedback));
  const [status, setStatus] = useState<Map<string, 'idle' | 'saving' | 'saved'>>(() => new Map());

  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const save = useCallback(
    async (studentId: string, text: string) => {
      setStatus((prev) => {
        const next = new Map(prev);
        next.set(studentId, 'saving');
        return next;
      });
      try {
        const res = await fetch('/api/evaluation/ptc-feedback', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            termId,
            sectionId,
            studentId,
            feedback: text || null,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? 'save failed');
        setStatus((prev) => {
          const next = new Map(prev);
          next.set(studentId, 'saved');
          return next;
        });
        setTimeout(() => {
          setStatus((prev) => {
            const next = new Map(prev);
            if (next.get(studentId) === 'saved') next.set(studentId, 'idle');
            return next;
          });
        }, 1500);
      } catch (e) {
        setStatus((prev) => {
          const next = new Map(prev);
          next.set(studentId, 'idle');
          return next;
        });
        toast.error(e instanceof Error ? e.message : 'save failed');
      }
    },
    [termId, sectionId],
  );

  function handleChange(studentId: string, next: string) {
    setFeedback((prev) => {
      const n = new Map(prev);
      n.set(studentId, next);
      return n;
    });
    const existing = timers.current.get(studentId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      timers.current.delete(studentId);
      void save(studentId, next);
    }, DEBOUNCE_MS);
    timers.current.set(studentId, t);
  }

  if (roster.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No students on the roster.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {roster.map((s) => {
        const text = feedback.get(s.student_id) ?? '';
        const st = status.get(s.student_id) ?? 'idle';
        return (
          <li key={s.student_id} className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[240px_1fr]">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
                  #{s.index_number}
                </span>
                <span className="font-serif text-[14px] font-semibold leading-snug tracking-tight text-foreground">
                  {s.student_name}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {s.student_number}
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  PTC feedback
                </span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {st === 'saving' && <>Saving…</>}
                  {st === 'saved' && (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <Check className="size-3" /> Saved
                    </span>
                  )}
                  {text.length > 0 && st === 'idle' && <>{text.length} chars</>}
                </span>
              </div>
              <textarea
                value={text}
                onChange={(e) => handleChange(s.student_id, e.target.value)}
                rows={2}
                placeholder="Parent feedback captured during the PTC (optional). Never prints on the report card."
                className="mt-1 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
