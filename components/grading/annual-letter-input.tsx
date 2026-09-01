'use client';

import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { cn } from '@/lib/utils';

// Inline popover for editing grade_entries.annual_letter_grade (KD #100).
// Registrar/school_admin/superadmin only — the server route enforces this.
// First-time entry (null → value) saves immediately without a note.
// Changing an existing value requires a correction note (audit trail).

const OPTIONS = [
  { value: 'Passed', label: 'Passed' },
  { value: 'UG', label: 'UG' },
  { value: 'E', label: 'E' },
  { value: 'NA', label: 'N.A.' },
] as const;

export function AnnualLetterInput({
  sheetId,
  entryId,
  initialValue,
  readOnly = false,
}: {
  sheetId: string;
  entryId: string;
  initialValue: string | null;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(initialValue);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');

  // Tier-2 mutation: the inline value has no optimistic local state (`saved`
  // only updates after the PATCH succeeds), so we don't add optimism — we just
  // route the existing fetch through useMutation. mutateAsync lets doSave keep
  // its exact early-return-on-failure semantics. The 'Failed to save' fallback
  // is preserved (ApiError.message already resolves to body.error).
  const saveMutation = useMutation({
    mutationFn: (vars: {
      value: string | null;
      correctionNote: string | null;
    }) =>
      apiFetch(
        `/api/grading-sheets/${sheetId}/entries/${entryId}/annual-letter`,
        jsonInit('PATCH', {
          annual_letter_grade: vars.value,
          correction_note: vars.correctionNote,
        })
      ),
  });
  const saving = saveMutation.isPending;

  const isFirstEntry = saved === null;
  const showNoteField =
    !isFirstEntry && selected !== null && selected !== saved;
  const canSave = showNoteField && note.trim() !== '';

  function handleOpenChange(next: boolean) {
    if (next) {
      setSelected(saved);
      setNote('');
    }
    setOpen(next);
  }

  async function doSave(value: string | null, correctionNote: string | null) {
    try {
      await saveMutation.mutateAsync({ value, correctionNote });
      setSaved(value);
      setNote('');
      setOpen(false);
    } catch (e) {
      // Non-2xx (ApiError) surfaces the route's message (body.error ?? 'Failed
      // to save'); any other failure (network) keeps the generic 'Failed to
      // save' exactly as before.
      toast.error(e instanceof ApiError ? e.message : 'Failed to save');
    }
  }

  async function handleOptionClick(value: string) {
    if (saving) return;
    if (isFirstEntry) {
      await doSave(value, null);
      return;
    }
    setSelected(value);
  }

  async function handleSave() {
    if (!selected || selected === saved) {
      setOpen(false);
      return;
    }
    await doSave(selected, note.trim() || null);
  }

  if (readOnly) {
    return (
      <span
        className={cn(
          'inline-flex h-7 w-16 items-center justify-center font-mono text-[11px] tabular-nums',
          saved ? 'font-medium text-foreground' : 'text-muted-foreground'
        )}
      >
        {saved ?? '—'}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-7 w-16 items-center justify-center gap-1 rounded border font-mono text-[11px] tabular-nums transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            saved
              ? 'border-border font-medium text-foreground'
              : 'border-dashed border-border text-muted-foreground'
          )}
        >
          <span>{saved ?? '—'}</span>
          <Pencil className="h-2.5 w-2.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      {/* Wider than the 16rem this used to be: the note box is now a rich-text
          field and its toolbar needs the room. */}
      <PopoverContent className="w-80 p-3" align="center" side="left">
        <div className="space-y-3">
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Final Grade
            </Label>
            {saved && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Current:{' '}
                <span className="font-mono font-medium text-foreground">
                  {saved}
                </span>
              </p>
            )}
          </div>

          <div className="grid grid-cols-4 gap-1">
            {OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={saving}
                onClick={() => handleOptionClick(opt.value)}
                className={cn(
                  'rounded-md border py-1.5 font-mono text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50',
                  selected === opt.value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-foreground hover:bg-muted/50'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {showNoteField && (
            <div className="space-y-1">
              <Label htmlFor={`note-${entryId}`} className="text-xs">
                Reason for change <span className="text-destructive">*</span>
              </Label>
              <RichTextEditor
                id={`note-${entryId}`}
                value={note}
                onChange={setNote}
                placeholder="Why is this Final Grade being changed?"
                rows={2}
                className="text-xs"
              />
            </div>
          )}

          {!isFirstEntry && (
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={saving || !canSave}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
