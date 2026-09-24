'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  SECTION_CLASS_TYPES,
  type SectionClassType,
} from '@/lib/schemas/section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// "Add a class" inside the stage dialog's class picker, for when the class
// the office wants to place a child in does not exist yet. Inline rather than
// a dialog on top of a dialog: it is a name, plus Global/Standard for a
// Secondary level. Creates in the student's year via POST /api/sections?ay=,
// the same route and rules as SIS Admin → Sections.
export function InlineAddSection({
  ayCode,
  level,
  onCreated,
}: {
  ayCode: string;
  level: { id: string; label: string; levelType: 'primary' | 'secondary' };
  onCreated: (section: { id: string; name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [classType, setClassType] = useState<SectionClassType | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSecondary = level.levelType === 'secondary';

  function reset() {
    setOpen(false);
    setName('');
    setClassType('');
    setError(null);
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return setError('Give the class a name');
    if (isSecondary && !classType)
      return setError('Pick Global or Standard for a Secondary class');
    setSaving(true);
    setError(null);
    try {
      const body = await apiFetch<{ id: string; name: string }>(
        `/api/sections?ay=${encodeURIComponent(ayCode)}`,
        jsonInit('POST', {
          name: trimmed,
          level_id: level.id,
          class_type: isSecondary ? classType : null,
        })
      );
      toast.success(`Created ${level.label} ${body.name} for ${ayCode}`);
      onCreated({ id: body.id, name: body.name });
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the class");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3.5" />
        Add a class at {level.label}
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
      <p className="text-xs font-medium text-foreground">
        New class at {level.label}, {ayCode}
      </p>
      <div className="flex gap-2">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
          placeholder="Class name, e.g. Patience"
          className="h-8 text-xs"
          disabled={saving}
        />
        {isSecondary && (
          <Select
            value={classType}
            onValueChange={(v) => setClassType(v as SectionClassType)}
            disabled={saving}
          >
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="Track" />
            </SelectTrigger>
            <SelectContent>
              {SECTION_CLASS_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={reset}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? 'Creating…' : 'Create class'}
        </Button>
      </div>
    </div>
  );
}
