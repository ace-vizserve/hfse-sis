'use client';

import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  XCircle,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import {
  concernHref,
  type Concern,
} from '@/components/admin/bulk-publish-concerns';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

// One section row in the bulk-publish dialog: compact line (checkbox · level ·
// name · readiness pill · chevron) that expands to a mini checklist of the
// section's specific concerns, each deep-linking to its fix surface carrying the
// selected term. Mirrors the single-section publish-window-panel ChecklistRow
// (KD #75), condensed. The pill is passed in (owned by the dialog) to avoid a
// circular import.
export function SectionReadinessRow({
  section,
  concerns,
  termId,
  selected,
  disabled,
  onToggle,
  pill,
}: {
  section: { id: string; name: string; level_label: string };
  concerns: Concern[];
  termId: string;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  pill: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasConcerns = concerns.length > 0;

  return (
    <div className="rounded-md">
      <div
        className={
          'flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40' +
          (disabled ? ' opacity-60' : '')
        }
      >
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggle()}
          disabled={disabled}
          aria-label={`Select ${section.level_label} ${section.name}`}
        />
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {section.level_label}
          </span>{' '}
          <span className="text-foreground">{section.name}</span>
        </div>
        {pill}
        {hasConcerns ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-expanded={expanded}
            aria-label={
              expanded ? 'Hide what needs fixing' : 'Show what needs fixing'
            }
            onClick={() => setExpanded((v) => !v)}
          >
            <ChevronDown
              className={
                'size-4 transition-transform' + (expanded ? ' rotate-180' : '')
              }
              aria-hidden
            />
          </Button>
        ) : (
          // Spacer keeps the pill column aligned for ready rows (no chevron).
          <span className="size-7 shrink-0" aria-hidden />
        )}
      </div>

      {expanded && hasConcerns ? (
        <ul className="mb-1 ml-8 mt-0.5 space-y-1 border-l border-border pl-3">
          {concerns.map((c) => {
            const href = concernHref(c.code, {
              sectionId: section.id,
              sectionName: section.name,
              termId,
            });
            const Icon = c.severity === 'hard' ? XCircle : AlertTriangle;
            return (
              <li key={c.code} className="flex items-center gap-2 text-sm">
                <Icon
                  className={
                    'size-3.5 shrink-0 ' +
                    (c.severity === 'hard'
                      ? 'text-destructive'
                      : 'text-brand-amber')
                  }
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {c.label}
                </span>
                {href ? (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 gap-1 text-xs"
                  >
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open <ArrowUpRight className="size-3" aria-hidden />
                    </a>
                  </Button>
                ) : (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    No quick fix
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
