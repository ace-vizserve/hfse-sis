'use client';

import { useState, useTransition } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ChecklistItemRow } from '@/lib/evaluation/checklist';

type TermOption = { id: string; label: string; term_number: number; is_current: boolean };
type SubjectOption = { id: string; code: string; name: string };
type LevelOption = { id: string; code: string; label: string; level_type: string };

export function ChecklistItemsEditor({
  terms,
  subjects,
  levels,
  selectedTermId,
  selectedSubjectId,
  selectedLevelId,
  items,
}: {
  terms: TermOption[];
  subjects: SubjectOption[];
  levels: LevelOption[];
  selectedTermId: string;
  selectedSubjectId: string;
  selectedLevelId: string;
  items: ChecklistItemRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [newText, setNewText] = useState('');

  function switchTriple(next: {
    term_id?: string;
    subject_id?: string;
    level_id?: string;
  }) {
    const qs = new URLSearchParams({
      term_id: next.term_id ?? selectedTermId,
      subject_id: next.subject_id ?? selectedSubjectId,
      level_id: next.level_id ?? selectedLevelId,
    });
    startTransition(() => router.push(`${pathname}?${qs.toString()}`));
  }

  async function addItem() {
    const text = newText.trim();
    if (!text) {
      toast.error('Item text required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/evaluation/checklist-items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          termId: selectedTermId,
          subjectId: selectedSubjectId,
          levelId: selectedLevelId,
          itemText: text,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'create failed');
      setNewText('');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'create failed');
    } finally {
      setBusy(false);
    }
  }

  async function updateItem(id: string, patch: { itemText?: string; sortOrder?: number }) {
    setBusy(true);
    try {
      const res = await fetch(`/api/evaluation/checklist-items/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'update failed');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'update failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/evaluation/checklist-items/${id}`, {
        method: 'DELETE',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'delete failed');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusy(false);
    }
  }

  const canEdit =
    !!selectedTermId && !!selectedSubjectId && !!selectedLevelId;

  return (
    <div className="space-y-5">
      {/* Three-axis picker */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Term</Label>
          <Select
            value={selectedTermId}
            onValueChange={(v) => switchTriple({ term_id: v })}
            disabled={pending}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a term" />
            </SelectTrigger>
            <SelectContent>
              {terms.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                  {t.is_current && (
                    <span className="ml-2 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
                      current
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Subject</Label>
          <Select
            value={selectedSubjectId}
            onValueChange={(v) => switchTriple({ subject_id: v })}
            disabled={pending}
          >
            <SelectTrigger>
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
        <div className="space-y-1.5">
          <Label>Level</Label>
          <Select
            value={selectedLevelId}
            onValueChange={(v) => switchTriple({ level_id: v })}
            disabled={pending}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a level" />
            </SelectTrigger>
            <SelectContent>
              {levels.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!canEdit ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-5 text-center text-sm text-muted-foreground">
          Pick a term, subject, and level to manage topics.
        </div>
      ) : (
        <>
          {/* Existing items */}
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-5 text-center text-sm text-muted-foreground">
              No topics yet. Add one below.
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  busy={busy}
                  onSave={(patch) => updateItem(item.id, patch)}
                  onDelete={() => deleteItem(item.id)}
                />
              ))}
            </ul>
          )}

          {/* Add-item row */}
          <div className="flex items-end gap-2 rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex-1 space-y-1">
              <Label htmlFor="new-item">Add topic</Label>
              <Input
                id="new-item"
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy) {
                    e.preventDefault();
                    addItem();
                  }
                }}
                placeholder="e.g. Sentence Structure: Simple and Compound"
                maxLength={500}
              />
            </div>
            <Button type="button" onClick={addItem} disabled={busy || !newText.trim()} className="gap-1.5">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Add
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ItemRow({
  item,
  busy,
  onSave,
  onDelete,
}: {
  item: ChecklistItemRow;
  busy: boolean;
  onSave: (patch: { itemText?: string; sortOrder?: number }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.item_text);
  const [sortOrder, setSortOrder] = useState(String(item.sort_order));

  const dirty =
    text.trim() !== item.item_text.trim() || Number(sortOrder) !== item.sort_order;

  async function commit() {
    const patch: { itemText?: string; sortOrder?: number } = {};
    if (text.trim() !== item.item_text.trim()) patch.itemText = text.trim();
    if (Number(sortOrder) !== item.sort_order) patch.sortOrder = Number(sortOrder);
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    await onSave(patch);
    setEditing(false);
  }

  return (
    <li className="grid grid-cols-[48px_1fr_auto] items-center gap-3 px-4 py-3">
      {/* Sort order */}
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={sortOrder}
        onChange={(e) => setSortOrder(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
        disabled={busy}
        className="h-8 text-center font-mono text-[11px] tabular-nums"
        title="Sort order"
      />

      {/* Text */}
      {editing ? (
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty) commit();
            if (e.key === 'Escape') {
              setText(item.item_text);
              setSortOrder(String(item.sort_order));
              setEditing(false);
            }
          }}
          autoFocus
          maxLength={500}
          className="h-8"
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-sm text-foreground hover:text-primary"
          onClick={() => setEditing(true)}
          title={item.item_text}
        >
          {item.item_text}
        </button>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        {editing && dirty && (
          <Button type="button" size="sm" disabled={busy} onClick={commit}>
            Save
          </Button>
        )}
        {editing && !dirty && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setText(item.item_text);
              setSortOrder(String(item.sort_order));
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        )}
        {!editing && dirty && (
          <Button type="button" size="sm" disabled={busy} onClick={commit}>
            Save sort
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
          aria-label="Delete item"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}
