'use client';

// Classroom Settings (Phase 6) — the two preferences the design spec ships,
// and nothing else. Two independent, unrelated mechanisms living in one
// panel because they're both "how I personally want to use this class page":
//
//   1. Student order — a display toggle for the Students-tab roster.
//      Client-persisted only (lib/classroom/use-student-order.ts,
//      localStorage); there is no server round trip and no schema. Applied
//      live by <ClassroomRosterTable> reading the same hook.
//   2. Private note — free text, saved via PATCH /api/classroom/[id]/notes.
//      Visible to nobody but its author (migration 094's RLS), which the
//      copy below says outright rather than leaving it implied.
//
// Deliberately NOT here: "show grade colours" / "show running average"
// (dropped — nothing in Classroom renders a grade or an average yet, so
// they'd be dead switches) or anything policy-shaped (grading, excused
// reasons, lock windows, ranking — those violate Hard Rules #1–#3 and live
// in SIS Admin, not a personal settings panel).

import { useMutation } from '@tanstack/react-query';
import { Lock, ListOrdered, NotebookPen } from 'lucide-react';
import { useState } from 'react';

import { useWriteAction } from '@/lib/hooks/use-write-action';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import {
  STUDENT_ORDER_DESCRIPTIONS,
  STUDENT_ORDER_LABELS,
  STUDENT_ORDER_VALUES,
} from '@/lib/classroom/student-order';
import { useStudentOrder } from '@/lib/classroom/use-student-order';
import { MAX_NOTE_LENGTH } from '@/lib/schemas/classroom';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

function SectionIcon({
  icon: Icon,
}: {
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
      <Icon className="size-4" />
    </div>
  );
}

export function ClassroomSettingsForm({
  sectionId,
  initialContent,
}: {
  sectionId: string;
  initialContent: string;
}) {
  const [order, setOrder] = useStudentOrder(sectionId);

  const [content, setContent] = useState(initialContent);
  const [baseline, setBaseline] = useState(initialContent);
  const dirty = content !== baseline;

  const saveNote = useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/classroom/${sectionId}/notes`,
        jsonInit('PATCH', { content })
      ),
  });

  // This save had NO refresh at all before — it updated its own baseline,
  // toasted, and left every server-rendered copy of the note showing the old
  // text until something else happened to re-render. Routing it through the
  // helper gives it the refresh it was missing.
  const run = useWriteAction();
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await run(() => saveNote.mutateAsync(), {
      pending: 'Saving note…',
      success: 'Note saved',
      error: (e) => (e instanceof Error ? e.message : 'Failed to save note'),
      onResolved: () => setBaseline(content),
    });
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <SectionIcon icon={ListOrdered} />
          <div className="space-y-1.5">
            <CardTitle className="font-serif text-lg font-semibold">
              Student order
            </CardTitle>
            <CardDescription>
              How the Students tab lists your roster. Only affects this browser
              — nobody else's view changes.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={order}
            onValueChange={(v) => setOrder(v as typeof order)}
            className="gap-3"
          >
            {STUDENT_ORDER_VALUES.map((value) => (
              <label
                key={value}
                htmlFor={`student-order-${value}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-brand-indigo/40 has-[[data-state=checked]]:bg-brand-indigo/5"
              >
                <RadioGroupItem
                  value={value}
                  id={`student-order-${value}`}
                  className="mt-0.5"
                />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium text-foreground">
                    {STUDENT_ORDER_LABELS[value]}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {STUDENT_ORDER_DESCRIPTIONS[value]}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <SectionIcon icon={NotebookPen} />
          <div className="space-y-1.5">
            <CardTitle className="font-serif text-lg font-semibold">
              Private note
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              <Lock className="size-3" />
              Only you can see this — not other teachers, not oversight roles.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Label htmlFor="classroom-note" className="sr-only">
            Private note about this class
          </Label>
          <Textarea
            id="classroom-note"
            value={content}
            onChange={(e) =>
              setContent(e.target.value.slice(0, MAX_NOTE_LENGTH))
            }
            placeholder="Jot anything worth remembering about this class — a seating quirk, who to follow up with, a reminder for next term…"
            maxLength={MAX_NOTE_LENGTH}
            className="min-h-[160px]"
            disabled={saving}
          />
          <p className="mt-1.5 text-right font-mono text-[10px] text-muted-foreground">
            {content.length.toLocaleString('en-SG')} /{' '}
            {MAX_NOTE_LENGTH.toLocaleString('en-SG')}
          </p>
        </CardContent>
        <CardFooter className="justify-end gap-3">
          {dirty && !saving && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-amber">
              <span
                className="size-1.5 rounded-full bg-brand-amber"
                aria-hidden="true"
              />
              Unsaved
            </span>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            loading={saving}
            loadingText="Saving…"
            disabled={!dirty}
          >
            Save note
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
