'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { CalendarRange, GraduationCap, Loader2, Users } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type LevelOption = { id: string; label: string };
type SectionOption = { id: string; name: string };

const ALL_LEVELS = '__all__';

export function MasterfileToolbar({
  ayCodes,
  selectedAyCode,
  levels,
  selectedLevelId,
  sections,
  selectedSectionId,
  allowAllLevels = false,
}: {
  ayCodes: readonly string[];
  selectedAyCode: string;
  levels: LevelOption[];
  selectedLevelId: string | null;
  sections: SectionOption[];
  selectedSectionId: string | null;
  /**
   * Offer "All grade levels" — the school-wide view. Off by default: the three
   * quick views that share this toolbar cannot render without a single level.
   */
  allowAllLevels?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onAyChange(ayCode: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('ay', ayCode);
    // Reset level + class — they're per-AY (subject_configs are keyed
    // (subject × level × ay)) so a level/class from another AY may not
    // exist or have different rosters.
    next.delete('level');
    next.delete('class');
    startTransition(() => {
      router.push(`?${next.toString()}`, { scroll: false });
      router.refresh();
    });
  }

  function onLevelChange(levelId: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (levelId === ALL_LEVELS) {
      // School-wide is the absence of a level, not a level of its own — so the
      // param is dropped rather than set to the sentinel. Keeps the default URL
      // clean and matches what the scope resolver looks for.
      next.delete('level');
    } else {
      next.set('level', levelId);
    }
    // Reset class filter — sections are level-scoped, the previous class
    // wouldn't exist at the new level.
    next.delete('class');
    startTransition(() => {
      router.push(`?${next.toString()}`, { scroll: false });
      router.refresh();
    });
  }

  function onClassChange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === '__all__') {
      next.delete('class');
    } else {
      next.set('class', value);
    }
    startTransition(() => {
      router.push(`?${next.toString()}`, { scroll: false });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      {ayCodes.length > 1 && (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Academic year
          </span>
          <Select value={selectedAyCode} onValueChange={onAyChange}>
            <SelectTrigger className="h-9 w-[150px]">
              <div className="flex items-center gap-2">
                {pending ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  <CalendarRange className="size-4 text-muted-foreground" />
                )}
                <SelectValue placeholder="Pick AY" />
              </div>
            </SelectTrigger>
            <SelectContent>
              {ayCodes.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Level
        </span>
        <Select
          value={selectedLevelId ?? (allowAllLevels ? ALL_LEVELS : '')}
          onValueChange={onLevelChange}
        >
          <SelectTrigger className="h-9 w-[180px]">
            <div className="flex items-center gap-2">
              {pending ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <GraduationCap className="size-4 text-muted-foreground" />
              )}
              <SelectValue placeholder="Pick a level" />
            </div>
          </SelectTrigger>
          <SelectContent>
            {allowAllLevels && (
              <SelectItem value={ALL_LEVELS}>All grade levels</SelectItem>
            )}
            {levels.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Class
        </span>
        <Select
          value={selectedSectionId ?? '__all__'}
          onValueChange={onClassChange}
          disabled={sections.length === 0}
        >
          <SelectTrigger className="h-9 w-[200px]">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              <SelectValue
                placeholder={
                  sections.length === 0 ? 'No classes' : 'All classes'
                }
              />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All classes</SelectItem>
            {sections.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
