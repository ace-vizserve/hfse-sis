'use client';

import { useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type PickerSection = { id: string; name: string; level_label: string };

export function SectionPicker({
  sections,
  selectedId,
}: {
  sections: PickerSection[];
  selectedId?: string;
}) {
  const router = useRouter();

  // Group sections by level for the SelectGroup rendering.
  const grouped = new Map<string, PickerSection[]>();
  for (const s of sections) {
    if (!grouped.has(s.level_label)) grouped.set(s.level_label, []);
    grouped.get(s.level_label)!.push(s);
  }
  const sortedLevels = Array.from(grouped.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <Select
      value={selectedId ?? ''}
      onValueChange={(v) => {
        if (v) router.push(`/report-cards?section_id=${v}`);
        else router.push('/report-cards');
      }}
    >
      <SelectTrigger className="h-9 w-full sm:w-[260px]">
        <SelectValue placeholder="— pick a section —" />
      </SelectTrigger>
      <SelectContent align="end">
        {sortedLevels.map(([levelLabel, sects]) => (
          <SelectGroup key={levelLabel}>
            <SelectLabel className="font-mono text-[10px] uppercase tracking-[0.14em]">
              {levelLabel}
            </SelectLabel>
            {sects
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
