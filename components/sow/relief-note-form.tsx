'use client';

import { Check } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { isEmptyRichText, proseLength } from '@/lib/rich-text';
import { CHECK_NOTE_MAX } from '@/lib/sow/check-options';

// "What did you cover?" (boards 13–14). One note per day: saving again today
// replaces the one already saved, so the box opens with it. The page's one
// primary action — recording is asked for, never enforced (spec §5.2).

export function ReliefNoteForm({
  sectionId,
  subjectId,
  weekNumber,
  initialNote,
  placeholder,
}: {
  sectionId: string;
  subjectId: string;
  /** The week the note is kept against; null when the class has no scheme. */
  weekNumber: number | null;
  initialNote: string | null;
  placeholder: string;
}) {
  const run = useWriteAction();
  const [note, setNote] = useState(initialNote ?? '');
  const [saving, setSaving] = useState(false);
  // What the server answered last, so "Saved" shows only for the saved text.
  const [saved, setSaved] = useState<{
    note: string;
    weekNumber: number | null;
  } | null>(null);

  const empty = isEmptyRichText(note);
  const tooLong = proseLength(note) > CHECK_NOTE_MAX;
  const showSaved = saved !== null && saved.note === note;

  async function save() {
    const sent = note;
    setSaving(true);
    const data = await run(
      () =>
        apiFetch<{ ok: true; weekNumber: number | null }>(
          '/api/sow/relief-notes',
          jsonInit('POST', { sectionId, subjectId, note: sent })
        ),
      {
        pending: 'Saving your note…',
        // The line under the box says it; a toast too would be the same
        // signal twice.
        success: () => null,
      }
    );
    // Shown once the save and the refresh are both done, so "Saved" never
    // sits beside a button still saying "Saving…".
    if (data) setSaved({ note: sent, weekNumber: data.weekNumber });
    setSaving(false);
  }

  return (
    <Card className="gap-3 px-5 py-5">
      <label
        htmlFor="relief-covered"
        className="text-[15px] font-semibold text-foreground"
      >
        What did you cover?
      </label>
      {weekNumber !== null && (
        <p className="text-[13px] text-muted-foreground">
          The subject teacher and the supervisor see this on Week {weekNumber}.
        </p>
      )}
      <RichTextEditor
        id="relief-covered"
        rows={4}
        maxLength={CHECK_NOTE_MAX}
        placeholder={placeholder}
        value={note}
        onChange={setNote}
      />
      {showSaved && (
        <p
          className="flex items-center gap-1.5 text-[13px] font-medium text-ink"
          role="status"
        >
          <Check className="size-3.5 text-brand-mint" aria-hidden />
          {saved.weekNumber !== null
            ? `Saved to Week ${saved.weekNumber}.`
            : 'Saved.'}
        </p>
      )}
      <div>
        <Button
          onClick={save}
          disabled={empty || tooLong}
          loading={saving}
          loadingText="Saving…"
        >
          Save what I covered
        </Button>
      </div>
    </Card>
  );
}
