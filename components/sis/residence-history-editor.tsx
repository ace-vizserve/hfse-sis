'use client';

import { Loader2, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

/**
 * ResidenceHistoryEditor — JSON-textarea editor for the
 * `residenceHistory` jsonb column. PATCHes via
 * `/api/sis/students/[enroleeNumber]/residence-history`.
 *
 * Server-side validation is shape-only (must be a JSON array of objects).
 * ICA's "past 5 years" expectation isn't enforced — see KD #58 + the
 * Open questions in docs/context/21-stp-application.md.
 */
export function ResidenceHistoryEditor({
  ayCode,
  enroleeNumber,
  initialJson,
}: {
  ayCode: string;
  enroleeNumber: string;
  initialJson: unknown;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Pretty-print initial value so the textarea is readable.
  const initialText = useMemo(() => stringifyForEdit(initialJson), [initialJson]);
  const [text, setText] = useState<string>(initialText);

  // Reset text whenever the dialog opens — pull the latest snapshot.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) setText(initialText);
  }

  async function onSave() {
    let parsed: unknown;
    const trimmed = text.trim();
    if (trimmed === '' || trimmed === 'null') {
      parsed = null;
    } else {
      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {
        toast.error(
          e instanceof SyntaxError
            ? `Invalid JSON: ${e.message}`
            : 'Could not parse JSON',
        );
        return;
      }
      if (!Array.isArray(parsed)) {
        toast.error('residenceHistory must be a JSON array (or empty / null)');
        return;
      }
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          toast.error('Each entry must be an object');
          return;
        }
      }
    }

    setBusy(true);
    try {
      const res = await fetch(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/residence-history?ay=${encodeURIComponent(ayCode)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ residenceHistory: parsed }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'Failed to save');
      toast.success('Residence history saved');
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  function appendBlankEntry() {
    let current: unknown[] = [];
    const trimmed = text.trim();
    if (trimmed && trimmed !== 'null') {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) current = parsed;
      } catch {
        toast.error('Fix existing JSON before appending a new row');
        return;
      }
    }
    current.push({
      country: '',
      cityOrTown: '',
      fromYear: '',
      toYear: '',
      purposeOfStay: '',
    });
    setText(JSON.stringify(current, null, 2));
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5">
            <Pencil className="size-3.5" />
            Edit residence history
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Edit residence history
            </DialogTitle>
            <DialogDescription>
              Past 5 years of residency. Each entry is a JSON object with{' '}
              <code className="font-mono">country</code>,{' '}
              <code className="font-mono">cityOrTown</code>,{' '}
              <code className="font-mono">fromYear</code>,{' '}
              <code className="font-mono">toYear</code>, and{' '}
              <code className="font-mono">purposeOfStay</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={14}
              spellCheck={false}
              className="font-mono text-xs leading-relaxed"
              placeholder='[\n  {\n    "country": "Singapore",\n    "cityOrTown": "Singapore",\n    "fromYear": 2020,\n    "toYear": "Present",\n    "purposeOfStay": "Schooling"\n  }\n]'
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Empty or <code className="font-mono">null</code> clears the field.
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={appendBlankEntry}
                disabled={busy}
              >
                Append blank entry
              </Button>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={onSave} disabled={busy}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function stringifyForEdit(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    // Could already be a JSON string — pretty-print if parseable.
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}
