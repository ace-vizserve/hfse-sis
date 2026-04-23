'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarRange, Loader2, Sparkles } from 'lucide-react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import type { SchoolCalendarRow } from '@/lib/attendance/calendar';

// "Carry holidays from [prior AY]" dialog. Shows prior-AY holidays grouped
// by month with checkboxes; on commit, POSTs them to the current target
// term with month+day preserved (year shifted to the target-term year).
//
// Moveable holidays (CNY, Good Friday, Hari Raya) will land on the wrong
// date and need manual adjustment — the preview makes that visible.
export function CopyHolidaysDialog({
  targetTermId,
  targetTermLabel,
  targetYear,
  sourceAyCode,
  sourceHolidays,
}: {
  targetTermId: string;
  targetTermLabel: string;
  targetYear: number;
  sourceAyCode: string;
  sourceHolidays: SchoolCalendarRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Selection map: source date → checked
  const [selection, setSelection] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sourceHolidays.map((h) => [h.date, true])),
  );

  const rows = useMemo(() => {
    return sourceHolidays.map((h) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(h.date);
      const targetDate = m
        ? `${targetYear}-${m[2]}-${m[3]}`
        : null;
      return { source: h, targetDate };
    });
  }, [sourceHolidays, targetYear]);

  // Group by source month for readability.
  const grouped = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.source.date.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    const entries = Array.from(map.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
    return entries.map(([ym, list]) => {
      const [y, m] = ym.split('-');
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-SG', {
        month: 'long',
        year: 'numeric',
      });
      return { ym, label, list };
    });
  }, [rows]);

  const selectedCount = Object.values(selection).filter(Boolean).length;

  function toggle(date: string) {
    setSelection((s) => ({ ...s, [date]: !s[date] }));
  }

  function setAll(v: boolean) {
    setSelection(Object.fromEntries(sourceHolidays.map((h) => [h.date, v])));
  }

  async function commit() {
    const entries = rows
      .filter((r) => r.targetDate && selection[r.source.date])
      .map((r) => ({
        date: r.targetDate!,
        isHoliday: true,
        label: r.source.label ?? 'Holiday',
      }));
    if (entries.length === 0) {
      toast.info('Nothing selected — nothing carried over.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/attendance/calendar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ termId: targetTermId, entries }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'save failed');
      toast.success(
        `Carried ${entries.length} holiday${entries.length === 1 ? '' : 's'} to ${targetTermLabel}. Moveable dates (CNY, Good Friday, Hari Raya) may need adjustment.`,
      );
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  if (sourceHolidays.length === 0) {
    // Nothing to carry. Render a disabled button with helpful tooltip.
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        className="gap-1.5"
        title={`${sourceAyCode} has no holidays on this term — nothing to carry forward.`}
      >
        <CalendarRange className="size-3.5" />
        Carry holidays
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Sparkles className="size-3.5" />
          Carry holidays from {sourceAyCode}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarRange className="size-5 text-primary" />
            Carry holidays forward
          </DialogTitle>
          <DialogDescription>
            Copying holidays from <strong>{sourceAyCode}</strong> into <strong>{targetTermLabel}</strong>{' '}
            (year {targetYear}). Month and day are preserved. Fixed-date holidays (National Day,
            Christmas) land correctly. Moveable ones (CNY, Good Friday, Hari Raya) will need
            manual adjustment — review before committing.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 px-0 py-2">
          <div className="font-mono text-[11px] text-muted-foreground">
            {selectedCount} of {sourceHolidays.length} selected
          </div>
          <div className="flex gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAll(true)}>
              Select all
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAll(false)}>
              Deselect all
            </Button>
          </div>
        </div>

        <ScrollArea className="h-[360px] rounded-xl border border-border">
          {grouped.map(({ ym, label, list }) => (
            <div key={ym}>
              <div className="sticky top-0 z-10 border-b border-border bg-muted/60 px-4 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {label}
              </div>
              {list.map((r) => {
                const checked = !!selection[r.source.date];
                const sameDay =
                  r.targetDate &&
                  r.source.date.slice(5) === r.targetDate.slice(5); // month+day match
                return (
                  <label
                    key={r.source.date}
                    className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2 last:border-b-0 hover:bg-muted/30"
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggle(r.source.date)} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground">
                        {r.source.label ?? 'Holiday'}
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                        <span>{r.source.date}</span>
                        <span className="text-border">→</span>
                        <span className={sameDay ? 'text-foreground' : 'text-amber-700 dark:text-amber-200'}>
                          {r.targetDate ?? '(bad date)'}
                        </span>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          ))}
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={commit}
            disabled={saving || selectedCount === 0}
            className="gap-1.5"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {saving ? 'Carrying…' : `Carry ${selectedCount} holiday${selectedCount === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
