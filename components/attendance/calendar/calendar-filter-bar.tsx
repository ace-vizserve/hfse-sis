'use client';

// CalendarFilterBar — one control per CALENDAR_FILTERS registry entry.
//
// Design system: §5 step 4 — composed from shadcn primitives (Checkbox,
// Select, DatePicker, Button). Tokens only; no raw hex.
// KD #44 — native <input type="date"> is banned; DatePicker is the canonical
// replacement.

import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AUDIENCE_LABELS,
  AUDIENCE_VALUES,
  EVENT_CATEGORY_LABELS,
  EVENT_CATEGORY_VALUES,
} from '@/lib/schemas/attendance';
import {
  CALENDAR_FILTERS,
  defaultFilterState,
  type CalendarFilterState,
  type StatusFilter,
} from '@/lib/attendance/calendar-filters';
import { EVENT_CATEGORY_LEGEND_COLOR } from '@/components/attendance/calendar/calendar-cell';

export type CalendarFilterBarProps = {
  value: CalendarFilterState;
  onChange: (next: CalendarFilterState) => void;
};

export function CalendarFilterBar({ value, onChange }: CalendarFilterBarProps) {
  function emit(patch: Partial<CalendarFilterState>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Filter controls — one section per CALENDAR_FILTERS entry */}
      {CALENDAR_FILTERS.map((def) => {
        if (def.control === 'date-range') {
          // date-range owns BOTH from and to; anchored on def.id = 'from'.
          return (
            <div key={def.id} className="flex flex-col gap-2">
              <p className="text-[13px] font-medium text-foreground">
                {def.label}
              </p>
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-1">
                  <label className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    From
                  </label>
                  <DatePicker
                    value={value.from ?? ''}
                    onChange={(d) => emit({ from: d || null })}
                    placeholder="Start date"
                    allowClear
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    To
                  </label>
                  <DatePicker
                    value={value.to ?? ''}
                    onChange={(d) => emit({ to: d || null })}
                    placeholder="End date"
                    allowClear
                  />
                </div>
              </div>
            </div>
          );
        }

        if (def.control === 'category-multi') {
          return (
            <div key={def.id} className="flex flex-col gap-2">
              <p className="text-[13px] font-medium text-foreground">
                {def.label}
              </p>
              <div className="flex flex-col gap-2">
                {EVENT_CATEGORY_VALUES.map((cat) => {
                  const checked = value.categories.includes(cat);
                  return (
                    <label
                      key={cat}
                      className="flex cursor-pointer items-center gap-2.5"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          if (v) {
                            emit({ categories: [...value.categories, cat] });
                          } else {
                            emit({
                              categories: value.categories.filter(
                                (c) => c !== cat
                              ),
                            });
                          }
                        }}
                      />
                      <ChartLegendChip
                        color={EVENT_CATEGORY_LEGEND_COLOR[cat]}
                        label={EVENT_CATEGORY_LABELS[cat]}
                      />
                    </label>
                  );
                })}
              </div>
              {value.categories.length > 0 && (
                <button
                  type="button"
                  className="self-start font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => emit({ categories: [] })}
                >
                  Show all
                </button>
              )}
            </div>
          );
        }

        if (def.control === 'level') {
          return (
            <div key={def.id} className="flex flex-col gap-2">
              <p className="text-[13px] font-medium text-foreground">
                {def.label}
              </p>
              <Select
                value={value.level}
                onValueChange={(v) =>
                  emit({ level: v as CalendarFilterState['level'] })
                }
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIENCE_VALUES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {AUDIENCE_LABELS[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }

        if (def.control === 'status') {
          const statusOptions: { value: StatusFilter; label: string }[] = [
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Open (attendance taken)' },
            { value: 'closed', label: 'Closed (no attendance)' },
          ];
          return (
            <div key={def.id} className="flex flex-col gap-2">
              <p className="text-[13px] font-medium text-foreground">
                {def.label}
              </p>
              <Select
                value={value.status}
                onValueChange={(v) => emit({ status: v as StatusFilter })}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }

        if (def.control === 'toggle') {
          // tentativeOnly — single boolean toggle
          const fieldKey = def.id as 'tentativeOnly';
          return (
            <div key={def.id} className="flex flex-col gap-2">
              <label className="flex cursor-pointer items-center gap-2.5">
                <Checkbox
                  checked={value[fieldKey] as boolean}
                  onCheckedChange={(v) => emit({ [fieldKey]: Boolean(v) })}
                />
                <span className="text-[13px] font-medium text-foreground">
                  {def.label}
                </span>
              </label>
            </div>
          );
        }

        return null;
      })}

      {/* Divider + clear-all */}
      <div className="border-t border-hairline pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => onChange(defaultFilterState())}
        >
          Clear all filters
        </Button>
      </div>
    </div>
  );
}
