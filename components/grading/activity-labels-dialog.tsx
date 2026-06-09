'use client';

import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { SlotLabels, SlotMeta } from '@/lib/schemas/grading-sheet';

type DraftMeta = { label: string; page: string; date: string };

function metaToDraft(m: SlotMeta | null | undefined): DraftMeta {
  return { label: m?.label ?? '', page: m?.page ?? '', date: m?.date ?? '' };
}

function draftToMeta(d: DraftMeta): SlotMeta {
  return {
    label: d.label.trim() || null,
    page: d.page.trim() || null,
    date: d.date || null,
  };
}

const COL_HEADER_CLASS =
  'pb-1.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground';

/**
 * Date Administered cell. Accepts a real date (via DatePicker) OR the literal
 * "Ongoing" (HFSE's Excel uses both). When "Ongoing", shows an amber pill +
 * clear button; otherwise shows the picker plus an "Ongoing" quick-set button.
 */
function DateAdministeredField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  if (value === 'Ongoing') {
    return (
      <div className="flex items-center gap-1">
        <span className="inline-flex items-center rounded-md border border-brand-amber/30 bg-brand-amber/10 px-2 py-1 font-mono text-[11px] font-semibold text-brand-amber">
          Ongoing
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
          aria-label="Clear ongoing — pick a date instead"
          onClick={() => onChange('')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <DatePicker
        value={value}
        onChange={onChange}
        placeholder="Pick a date"
        className="h-8"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 shrink-0 px-2 text-[11px] text-muted-foreground"
        aria-label="Mark as ongoing"
        onClick={() => onChange('Ongoing')}
      >
        Ongoing
      </Button>
    </div>
  );
}

export function ActivityLabelsDialog({
  sheetId,
  wwCount,
  ptCount,
  initialLabels,
}: {
  sheetId: string;
  wwCount: number;
  ptCount: number;
  initialLabels: SlotLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wwDraft, setWwDraft] = useState<DraftMeta[]>([]);
  const [ptDraft, setPtDraft] = useState<DraftMeta[]>([]);
  const [qaDraft, setQaDraft] = useState('');

  function openDialog() {
    setWwDraft(
      Array.from({ length: wwCount }, (_, i) =>
        metaToDraft((initialLabels.ww ?? [])[i])
      )
    );
    setPtDraft(
      Array.from({ length: ptCount }, (_, i) =>
        metaToDraft((initialLabels.pt ?? [])[i])
      )
    );
    setQaDraft(initialLabels.qa ?? '');
    setOpen(true);
  }

  function closeDialog() {
    setWwDraft([]);
    setPtDraft([]);
    setQaDraft('');
    setOpen(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/grading-sheets/${sheetId}/labels`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ww: wwDraft.map(draftToMeta),
          pt: ptDraft.map(draftToMeta),
          qa: qaDraft.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success('Activity labels saved.');
      closeDialog();
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save labels.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        <Pencil className="mr-1.5 h-3.5 w-3.5" />
        Activity Labels
      </Button>

      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) closeDialog();
          else setOpen(true);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg">
              Activity Labels
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className={`w-14 ${COL_HEADER_CLASS}`}>Slot</th>
                  <th className={COL_HEADER_CLASS}>Description</th>
                  <th className={`w-24 ${COL_HEADER_CLASS}`}>Page #</th>
                  <th className={`w-40 ${COL_HEADER_CLASS}`}>
                    Date Administered
                  </th>
                </tr>
              </thead>
              <tbody>
                {wwCount > 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="pb-1 pt-4 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      Written Work
                    </td>
                  </tr>
                )}
                {wwDraft.map((d, i) => (
                  <tr key={`ww-${i}`} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 font-mono text-[11px] font-semibold text-muted-foreground">
                      W{i + 1}
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        value={d.label}
                        onChange={(e) => {
                          const next = [...wwDraft];
                          next[i] = { ...next[i], label: e.target.value };
                          setWwDraft(next);
                        }}
                        placeholder="e.g. Worksheet 2: Multiplication Tables"
                        className="h-8 text-sm"
                        maxLength={120}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        value={d.page}
                        onChange={(e) => {
                          const next = [...wwDraft];
                          next[i] = { ...next[i], page: e.target.value };
                          setWwDraft(next);
                        }}
                        placeholder="—"
                        className="h-8 text-sm"
                        maxLength={40}
                      />
                    </td>
                    <td className="py-1.5">
                      <DateAdministeredField
                        value={d.date}
                        onChange={(date) => {
                          const next = [...wwDraft];
                          next[i] = { ...next[i], date };
                          setWwDraft(next);
                        }}
                      />
                    </td>
                  </tr>
                ))}

                {ptCount > 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="pb-1 pt-4 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      Performance Task
                    </td>
                  </tr>
                )}
                {ptDraft.map((d, i) => (
                  <tr key={`pt-${i}`} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 font-mono text-[11px] font-semibold text-muted-foreground">
                      PT{i + 1}
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        value={d.label}
                        onChange={(e) => {
                          const next = [...ptDraft];
                          next[i] = { ...next[i], label: e.target.value };
                          setPtDraft(next);
                        }}
                        placeholder="e.g. Quiz 1"
                        className="h-8 text-sm"
                        maxLength={120}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        value={d.page}
                        onChange={(e) => {
                          const next = [...ptDraft];
                          next[i] = { ...next[i], page: e.target.value };
                          setPtDraft(next);
                        }}
                        placeholder="—"
                        className="h-8 text-sm"
                        maxLength={40}
                      />
                    </td>
                    <td className="py-1.5">
                      <DateAdministeredField
                        value={d.date}
                        onChange={(date) => {
                          const next = [...ptDraft];
                          next[i] = { ...next[i], date };
                          setPtDraft(next);
                        }}
                      />
                    </td>
                  </tr>
                ))}

                <tr>
                  <td
                    colSpan={4}
                    className="pb-1 pt-4 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    Quarterly Assessment
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 font-mono text-[11px] font-semibold text-muted-foreground">
                    QA
                  </td>
                  <td className="py-1.5 pr-2" colSpan={3}>
                    <Input
                      value={qaDraft}
                      onChange={(e) => setQaDraft(e.target.value)}
                      placeholder="e.g. Quarterly Exam"
                      className="h-8 text-sm"
                      maxLength={120}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
