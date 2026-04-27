'use client';

import { Loader2, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * ResidenceHistoryEditor — structured form for the `residenceHistory` jsonb
 * column. ICA Student Pass applications require past-5-year residency history
 * with at least one entry; admins must be able to add/remove entries inline
 * but never reduce the list to zero.
 *
 * PATCH endpoint: `/api/sis/students/[enroleeNumber]/residence-history`.
 * Server validates shape (array of objects); this editor validates that each
 * entry is complete + that at least one entry exists.
 */

type ResidenceEntry = {
  country: string;
  cityOrTown: string;
  fromYear: string; // number-as-string for input flexibility
  toYear: string;   // number-as-string OR 'Present'
  purposeOfStay: string;
};

const PRESENT_TOKEN = 'Present';
const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1900;
const MAX_YEAR = CURRENT_YEAR + 5;

function blankEntry(): ResidenceEntry {
  return {
    country: '',
    cityOrTown: '',
    fromYear: '',
    toYear: PRESENT_TOKEN,
    purposeOfStay: '',
  };
}

// Coerce arbitrary jsonb input to our editor shape. Tolerates already-parsed
// arrays, JSON-stringified arrays, and entries with missing/extra fields.
function parseInitial(value: unknown): ResidenceEntry[] {
  let raw: unknown = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const r = item as Record<string, unknown>;
      const fromY = r.fromYear;
      const toY = r.toYear;
      return {
        country: typeof r.country === 'string' ? r.country : '',
        cityOrTown: typeof r.cityOrTown === 'string' ? r.cityOrTown : '',
        fromYear:
          typeof fromY === 'number'
            ? String(fromY)
            : typeof fromY === 'string'
              ? fromY
              : '',
        toYear:
          typeof toY === 'number'
            ? String(toY)
            : typeof toY === 'string'
              ? toY
              : PRESENT_TOKEN,
        purposeOfStay: typeof r.purposeOfStay === 'string' ? r.purposeOfStay : '',
      } as ResidenceEntry;
    })
    .filter((e): e is ResidenceEntry => e !== null);
}

// Validate a single entry. Returns null if valid, else an error message.
function validateEntry(e: ResidenceEntry): string | null {
  if (!e.country.trim()) return 'Country is required';
  if (!e.cityOrTown.trim()) return 'City / town is required';
  if (!e.purposeOfStay.trim()) return 'Purpose of stay is required';
  const from = Number(e.fromYear);
  if (!Number.isFinite(from) || !Number.isInteger(from)) {
    return 'From year must be a 4-digit year';
  }
  if (from < MIN_YEAR || from > MAX_YEAR) {
    return `From year must be between ${MIN_YEAR} and ${MAX_YEAR}`;
  }
  if (e.toYear !== PRESENT_TOKEN) {
    const to = Number(e.toYear);
    if (!Number.isFinite(to) || !Number.isInteger(to)) {
      return "To year must be a 4-digit year or 'Present'";
    }
    if (to < MIN_YEAR || to > MAX_YEAR) {
      return `To year must be between ${MIN_YEAR} and ${MAX_YEAR}`;
    }
    if (to < from) return 'To year cannot be earlier than from year';
  }
  return null;
}

// Convert editor entries to the jsonb shape ICA expects.
function serializeEntries(entries: ResidenceEntry[]): unknown[] {
  return entries.map((e) => ({
    country: e.country.trim(),
    cityOrTown: e.cityOrTown.trim(),
    fromYear: Number(e.fromYear),
    toYear: e.toYear === PRESENT_TOKEN ? PRESENT_TOKEN : Number(e.toYear),
    purposeOfStay: e.purposeOfStay.trim(),
  }));
}

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

  const initialEntries = useMemo(() => {
    const parsed = parseInitial(initialJson);
    // ICA requires at least one entry — start with a blank if empty.
    return parsed.length > 0 ? parsed : [blankEntry()];
  }, [initialJson]);

  const [entries, setEntries] = useState<ResidenceEntry[]>(initialEntries);

  // Reset entries whenever the dialog opens — pull the latest snapshot.
  useEffect(() => {
    if (open) setEntries(initialEntries);
  }, [open, initialEntries]);

  function updateEntry(index: number, patch: Partial<ResidenceEntry>) {
    setEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    );
  }

  function addEntry() {
    setEntries((prev) => [...prev, blankEntry()]);
  }

  function removeEntry(index: number) {
    setEntries((prev) => {
      // ICA requires min 1 — guard at UI even though button is disabled.
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }

  async function onSave() {
    if (entries.length < 1) {
      toast.error('At least one residence entry is required for ICA');
      return;
    }
    for (let i = 0; i < entries.length; i++) {
      const err = validateEntry(entries[i]);
      if (err) {
        toast.error(`Residence ${i + 1}: ${err}`);
        return;
      }
    }

    setBusy(true);
    try {
      const payload = serializeEntries(entries);
      const res = await fetch(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/residence-history?ay=${encodeURIComponent(ayCode)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ residenceHistory: payload }),
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

  // Quick-summary count for the trigger button label.
  const summaryCount = entries.length;
  const hasSummary = summaryCount > 0;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5">
            <Pencil className="size-3.5" />
            {hasSummary
              ? `Edit residence history (${summaryCount})`
              : 'Add residence history'}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Residence history
            </DialogTitle>
            <DialogDescription>
              Past 5 years of residency for ICA Student Pass application. At
              least one entry is required.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {entries.map((entry, i) => {
              const isPresent = entry.toYear === PRESENT_TOKEN;
              const canRemove = entries.length > 1;
              return (
                <div
                  key={i}
                  className="rounded-lg border border-hairline bg-card p-4 shadow-sm"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      <MapPin className="size-3.5" aria-hidden />
                      Residence {i + 1}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => removeEntry(i)}
                      disabled={!canRemove || busy}
                      title={
                        canRemove
                          ? 'Remove this entry'
                          : 'At least one entry is required for ICA'
                      }
                      className="gap-1.5 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                      Remove
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`country-${i}`} className="text-xs">
                        Country
                      </Label>
                      <Input
                        id={`country-${i}`}
                        value={entry.country}
                        onChange={(e) =>
                          updateEntry(i, { country: e.target.value })
                        }
                        placeholder="e.g. Singapore"
                        disabled={busy}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`city-${i}`} className="text-xs">
                        City / Town
                      </Label>
                      <Input
                        id={`city-${i}`}
                        value={entry.cityOrTown}
                        onChange={(e) =>
                          updateEntry(i, { cityOrTown: e.target.value })
                        }
                        placeholder="e.g. Singapore"
                        disabled={busy}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`from-${i}`} className="text-xs">
                        From year
                      </Label>
                      <Input
                        id={`from-${i}`}
                        type="number"
                        inputMode="numeric"
                        min={MIN_YEAR}
                        max={MAX_YEAR}
                        value={entry.fromYear}
                        onChange={(e) =>
                          updateEntry(i, { fromYear: e.target.value })
                        }
                        placeholder="2020"
                        disabled={busy}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`to-${i}`} className="text-xs">
                        To year
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id={`to-${i}`}
                          type="number"
                          inputMode="numeric"
                          min={MIN_YEAR}
                          max={MAX_YEAR}
                          value={isPresent ? '' : entry.toYear}
                          onChange={(e) =>
                            updateEntry(i, { toYear: e.target.value })
                          }
                          placeholder={isPresent ? PRESENT_TOKEN : '2025'}
                          disabled={busy || isPresent}
                          className={cn(isPresent && 'opacity-50')}
                        />
                        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <Checkbox
                            checked={isPresent}
                            onCheckedChange={(checked) =>
                              updateEntry(i, {
                                toYear: checked === true ? PRESENT_TOKEN : '',
                              })
                            }
                            disabled={busy}
                          />
                          Present
                        </label>
                      </div>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor={`purpose-${i}`} className="text-xs">
                        Purpose of stay
                      </Label>
                      <Input
                        id={`purpose-${i}`}
                        value={entry.purposeOfStay}
                        onChange={(e) =>
                          updateEntry(i, { purposeOfStay: e.target.value })
                        }
                        placeholder="e.g. Schooling, Employment, Dependent"
                        disabled={busy}
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addEntry}
              disabled={busy}
              className="w-full gap-1.5 border-dashed"
            >
              <Plus className="size-3.5" />
              Add another residence
            </Button>
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
