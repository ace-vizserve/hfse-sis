'use client';

import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';

// Which components a grade is made of, and what share each carries.
//
// ── ONE COMPONENT, TWO SURFACES ────────────────────────────────────────────
//
// Subject setup sets this for a whole term (every class); the grading sheet's
// "Edit totals & slots" sets it for ONE class, which is the exception Mr Ace
// asked for on 2026-09-15: "currently its per level and there might be cases
// where its per section". Both write the same three columns (migration 159).
//
// They share this file rather than each drawing their own chips, because the
// colours are a KEY: written work is chart-3 on both screens or it is not a key
// at all (09a §10.2 — the cells own the map, everything else reads it). The map
// matches `RatioBar` in components/sis/subject-config-form.tsx, which is where
// this vocabulary started.

export type GradeComponent = 'ww' | 'pt' | 'qa';

export const COMPONENT_PAINT: Record<
  GradeComponent,
  { swatch: string; label: string }
> = {
  ww: { swatch: 'bg-chart-3', label: 'Written work' },
  pt: { swatch: 'bg-brand-indigo', label: 'Performance tasks' },
  qa: { swatch: 'bg-brand-amber', label: 'Exam' },
};

export const GRADE_COMPONENTS: GradeComponent[] = ['ww', 'pt', 'qa'];

/** Integer percentages, the unit every weight in this app is written in. */
export type ComponentWeights = Record<GradeComponent, number>;

/**
 * Hand the share of every component NOT in use to the ones that are, in
 * proportion to what they already carry.
 *
 * The client-side twin of `redistributeWeights` in
 * `lib/grading/resolve-sheet-weights.ts`, in whole percentage points so the
 * chips show exactly what will be saved. `__tests__/grading/component-weight-chips.test.ts`
 * pins the two against each other — a screen that previews 37/63 and saves
 * 38/62 is worse than one that previews nothing.
 */
export function redistributePercents(
  base: ComponentWeights,
  inUse: Record<GradeComponent, boolean>
): ComponentWeights {
  const kept = GRADE_COMPONENTS.filter((c) => inUse[c]);
  if (kept.length === 0) return { ww: 0, pt: 0, qa: 0 };

  const keptTotal = kept.reduce((sum, c) => sum + base[c], 0);
  const shares = kept.map((c) => ({
    component: c,
    exact: keptTotal <= 0 ? 100 / kept.length : (base[c] * 100) / keptTotal,
  }));

  // Largest-remainder apportionment, tie broken toward the component already
  // carrying more — so Filipino's 30/50 with no exam lands on 37/63 rather than
  // being decided by a floating-point rounding accident.
  const floored = shares.map((s) => ({ ...s, whole: Math.floor(s.exact) }));
  let remaining = 100 - floored.reduce((sum, s) => sum + s.whole, 0);
  const byRemainder = [...floored].sort((a, b) => {
    const frac = b.exact - b.whole - (a.exact - a.whole);
    if (Math.abs(frac) > 1e-9) return frac;
    return base[b.component] - base[a.component];
  });
  for (const s of byRemainder) {
    if (remaining <= 0) break;
    s.whole += 1;
    remaining -= 1;
  }

  const out: ComponentWeights = { ww: 0, pt: 0, qa: 0 };
  for (const s of floored) out[s.component] = s.whole;
  return out;
}

/** The components switched on, as a record. */
export function inUseFromWeights(
  values: ComponentWeights
): Record<GradeComponent, boolean> {
  return { ww: values.ww > 0, pt: values.pt > 0, qa: values.qa > 0 };
}

/**
 * Is this typed split one the server will accept? Mirrors `isManualWeightSplit`
 * in `lib/grading/resolve-sheet-weights.ts`: parts off are 0, parts on are
 * whole numbers of at least 1, and the lot adds to 100.
 */
export function manualSplitIsValid(
  values: ComponentWeights,
  inUse: Record<GradeComponent, boolean>
): boolean {
  if (!GRADE_COMPONENTS.some((c) => inUse[c])) return false;
  let total = 0;
  for (const c of GRADE_COMPONENTS) {
    const v = values[c];
    if (!Number.isInteger(v)) return false;
    if (inUse[c] ? v < 1 : v !== 0) return false;
    total += v;
  }
  return total === 100;
}

/**
 * Number boxes for the parts still counting, shown when a part has been
 * switched off and two remain (one remaining part is simply 100). Pre-filled by
 * the caller with the automatic split; the registrar may change it, and Save
 * stays off until the two add up to 100.
 */
export function RemainingWeightInputs({
  values,
  inUse,
  onChange,
  disabled = false,
  scopeLabel,
}: {
  values: ComponentWeights;
  inUse: Record<GradeComponent, boolean>;
  onChange: (component: GradeComponent, percent: number) => void;
  disabled?: boolean;
  scopeLabel: string;
}) {
  const kept = GRADE_COMPONENTS.filter((c) => inUse[c]);
  if (kept.length !== 2) return null;
  const total = kept.reduce((sum, c) => sum + (values[c] || 0), 0);
  const ok = manualSplitIsValid(values, inUse);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {kept.map((c) => (
          <label
            key={c}
            className="flex items-center gap-1.5 text-[12px] text-ink-2"
          >
            <span
              aria-hidden
              className={cn('size-2 rounded-sm', COMPONENT_PAINT[c].swatch)}
            />
            {COMPONENT_PAINT[c].label}
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              step={1}
              disabled={disabled}
              value={Number.isFinite(values[c]) ? values[c] : ''}
              aria-label={`${COMPONENT_PAINT[c].label} percentage for ${scopeLabel}`}
              onChange={(e) =>
                onChange(
                  c,
                  e.target.value === '' ? Number.NaN : Number(e.target.value)
                )
              }
              className="h-7 w-16 px-2 text-right text-[12px] tabular-nums"
            />
            <span className="text-muted-foreground">%</span>
          </label>
        ))}
      </div>
      <p
        role="status"
        className={cn(
          'text-[11px] leading-snug',
          ok ? 'text-muted-foreground' : 'text-destructive'
        )}
      >
        {ok
          ? 'Adds up to 100.'
          : `These must add up to 100 — now ${Number.isFinite(total) ? total : 0}. Use whole numbers, at least 1 each.`}
      </p>
    </div>
  );
}

/**
 * The three chips plus the ratio bar they document.
 *
 * `onToggle` absent renders it read-only — the same paint, no controls — so a
 * surface that only reports the split cannot drift from one that sets it.
 *
 * `inUse` overrides "a part is on when its percentage is above 0" — needed while
 * a typed box is empty or 0, when the part still counts but shows no share.
 */
export function ComponentWeightChips({
  values,
  inUse: inUseProp,
  onToggle,
  disabled = false,
  scopeLabel,
  className,
}: {
  values: ComponentWeights;
  inUse?: Record<GradeComponent, boolean>;
  onToggle?: (component: GradeComponent) => void;
  disabled?: boolean;
  /** Named in each chip's accessible label, e.g. "Term 3" or "this class". */
  scopeLabel: string;
  className?: string;
}) {
  const readOnly = !onToggle;
  const isOn = (c: GradeComponent) =>
    inUseProp ? inUseProp[c] : values[c] > 0;
  const share = (c: GradeComponent) =>
    Number.isFinite(values[c]) ? Math.max(0, values[c]) : 0;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {GRADE_COMPONENTS.map((component) => {
          const on = isOn(component);
          const paint = COMPONENT_PAINT[component];
          const chipBody = (
            <>
              <span
                aria-hidden
                className={cn(
                  'size-2 rounded-sm',
                  on ? paint.swatch : 'bg-hairline-strong'
                )}
              />
              {paint.label}
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {on ? share(component) : '—'}
              </span>
            </>
          );
          const shape = cn(
            'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium',
            on
              ? 'border-hairline-strong bg-card text-ink-2'
              : 'border-dashed border-border text-ink-5'
          );

          if (readOnly) {
            return (
              <span key={component} className={shape}>
                {chipBody}
              </span>
            );
          }

          return (
            <Toggle
              key={component}
              size="sm"
              pressed={on}
              disabled={disabled}
              onPressedChange={() => onToggle(component)}
              aria-label={
                on
                  ? `${paint.label} counts in ${scopeLabel}. Untick to remove it.`
                  : `${paint.label} does not count in ${scopeLabel}. Tick to add it.`
              }
              className={cn(
                shape,
                on && 'data-[state=on]:bg-card data-[state=on]:text-ink-2'
              )}
            >
              {chipBody}
            </Toggle>
          );
        })}
      </div>

      <div
        className="flex h-2 w-[132px] overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${scopeLabel}: ${GRADE_COMPONENTS.filter(isOn)
          .map((c) => `${COMPONENT_PAINT[c].label} ${share(c)}%`)
          .join(', ')}`}
      >
        {GRADE_COMPONENTS.map((component) =>
          isOn(component) && share(component) > 0 ? (
            <div
              key={component}
              className={cn(
                'transition-[flex-basis] duration-200',
                COMPONENT_PAINT[component].swatch
              )}
              style={{ flexBasis: `${share(component)}%` }}
            />
          ) : null
        )}
      </div>
    </div>
  );
}
