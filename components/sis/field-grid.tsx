'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { cn } from '@/lib/utils';

export type FieldValue = string | number | boolean | null | undefined;

export type Field = {
  label: string;
  value: FieldValue;
  // Display the value as a date (yyyy-MM-dd or ISO string → en-SG locale).
  // Defaults to false; use for date columns from the admissions tables.
  asDate?: boolean;
  // Render multi-line text instead of a single line. Use for remarks / notes.
  multiline?: boolean;
  // Span 2 columns on the grid (useful for long text).
  wide?: boolean;
  // Mask the rendered value behind a reveal toggle (passport/pass numbers).
  sensitive?: boolean;
};

export type FieldSection = {
  title: string;
  fields: Field[];
  // Hide the entire section if every field value is empty.
  hideIfAllEmpty?: boolean;
};

const EMPTY_PLACEHOLDER = '—';
const MASK_PLACEHOLDER = '••••••••';

function isEmpty(v: FieldValue): boolean {
  return (
    v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
  );
}

function formatDate(v: FieldValue): string {
  if (isEmpty(v)) return EMPTY_PLACEHOLDER;
  const s = String(v);
  // Date-only (yyyy-MM-dd) — render without timezone shift
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-SG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  return new Date(t).toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function renderValue(f: Field): React.ReactNode {
  if (f.asDate) return formatDate(f.value);
  if (typeof f.value === 'boolean') {
    return f.value ? 'Yes' : 'No';
  }
  if (isEmpty(f.value)) return EMPTY_PLACEHOLDER;
  return String(f.value);
}

export function FieldGrid({
  fields,
  dimEmpty = false,
}: {
  fields: Field[];
  /**
   * When true, empty fields render with their entire row at lower contrast
   * (label + value both muted/60) so eyes skip past them. Defaults to
   * false so existing call sites keep their current treatment.
   */
  dimEmpty?: boolean;
}) {
  const [revealed, setRevealed] = React.useState<Set<string>>(new Set());
  const visible = fields;
  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground">{EMPTY_PLACEHOLDER}</p>;
  }

  function toggleRevealed(key: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {visible.map((f, i) => {
        const key = `${f.label}-${i}`;
        const empty =
          !f.asDate && typeof f.value !== 'boolean' && isEmpty(f.value);
        const dim = dimEmpty && empty;
        const isMasked = Boolean(f.sensitive) && !empty;
        const isRevealed = revealed.has(key);
        return (
          <div
            key={key}
            className={cn('min-w-0 space-y-0.5', f.wide && 'sm:col-span-2')}
          >
            <dt
              className={cn(
                'font-mono text-[10px] font-semibold uppercase tracking-[0.12em]',
                dim ? 'text-muted-foreground/60' : 'text-muted-foreground'
              )}
            >
              {f.label}
            </dt>
            <dd
              className={cn(
                'break-words text-sm leading-relaxed',
                dim
                  ? 'text-muted-foreground/60'
                  : empty
                    ? 'text-muted-foreground'
                    : 'text-foreground',
                f.multiline && 'whitespace-pre-line',
                isMasked && 'flex items-center gap-1.5'
              )}
            >
              {isMasked ? (
                <>
                  <span>{isRevealed ? renderValue(f) : MASK_PLACEHOLDER}</span>
                  <button
                    type="button"
                    onClick={() => toggleRevealed(key)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={
                      isRevealed ? `Hide ${f.label}` : `Show ${f.label}`
                    }
                  >
                    {isRevealed ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </button>
                </>
              ) : (
                renderValue(f)
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function FieldSectionsCard({ sections }: { sections: FieldSection[] }) {
  return (
    <div className="space-y-6">
      {sections.map((s) => {
        if (s.hideIfAllEmpty) {
          const allEmpty = s.fields.every(
            (f) => typeof f.value !== 'boolean' && !f.asDate && isEmpty(f.value)
          );
          if (allEmpty) return null;
        }
        return (
          <section key={s.title} className="space-y-3">
            <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
              {s.title}
            </h3>
            <FieldGrid fields={s.fields} />
          </section>
        );
      })}
    </div>
  );
}
