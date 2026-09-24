'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy } from 'lucide-react';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type CopyableSection = {
  id: string;
  name: string;
  levelLabel: string;
  classType: string | null;
};

export type CopySource = {
  ayCode: string;
  /** Sections in that year the target year does not have yet, in level order. */
  missing: CopyableSection[];
};

// "Copy sections from another year" on /sis/sections. Sets a new year up from
// an old one in one action, so admissions never places a child into a section
// the SIS does not have (the sync skips those children silently). Everything
// is ticked by default; untick a class that is not running this year.
export function CopySectionsButton({
  targetAyCode,
  sources,
}: {
  targetAyCode: string;
  sources: CopySource[];
}) {
  const run = useWriteAction();
  const [open, setOpen] = useState(false);
  const [fromAy, setFromAy] = useState(sources[0]?.ayCode ?? '');
  const source = sources.find((s) => s.ayCode === fromAy);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Re-tick everything whenever the dialog opens or the source year changes.
  useEffect(() => {
    if (open) setPicked(new Set(source?.missing.map((s) => s.id) ?? []));
  }, [open, source]);

  const byLevel = useMemo(() => {
    const m = new Map<string, CopyableSection[]>();
    for (const s of source?.missing ?? []) {
      const list = m.get(s.levelLabel) ?? [];
      list.push(s);
      m.set(s.levelLabel, list);
    }
    return [...m.entries()];
  }, [source]);

  const copyMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ created: number }>(
        `/api/sections/copy?ay=${encodeURIComponent(targetAyCode)}`,
        jsonInit('POST', { from_ay: fromAy, section_ids: [...picked] })
      ),
  });

  async function onCopy() {
    const n = picked.size;
    await run(() => copyMutation.mutateAsync(), {
      pending: `Copying ${n} section${n === 1 ? '' : 's'}…`,
      success: (body) =>
        `Copied ${body.created} section${body.created === 1 ? '' : 's'} into ${targetAyCode}`,
      error: (e) => (e instanceof Error ? e.message : 'Copy failed'),
      onResolved: () => setOpen(false),
    });
  }

  function toggle(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const busy = copyMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Copy className="size-3.5" />
          Copy sections
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copy sections into {targetAyCode}</DialogTitle>
          <DialogDescription>
            Copies each class's name, level and Global/Standard track. Form
            class advisers and students are not copied. Classes {targetAyCode}{' '}
            already has are left out.
          </DialogDescription>
        </DialogHeader>

        {sources.length > 1 && (
          <Select value={fromAy} onValueChange={setFromAy}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder="Copy from" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.ayCode} value={s.ayCode}>
                  From {s.ayCode} ({s.missing.length} to add)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="max-h-80 space-y-3 overflow-y-auto py-1">
          {byLevel.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              {targetAyCode} already has every section {fromAy} had.
            </p>
          ) : (
            byLevel.map(([level, list]) => (
              <div key={level} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {level}
                </p>
                {list.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40"
                  >
                    <Checkbox
                      checked={picked.has(s.id)}
                      onCheckedChange={(v) => toggle(s.id, v === true)}
                      disabled={busy}
                    />
                    <span className="text-foreground">{s.name}</span>
                    {s.classType && (
                      <span className="text-xs text-muted-foreground">
                        {s.classType}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={onCopy} disabled={busy || picked.size === 0}>
            Copy {picked.size} section{picked.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
