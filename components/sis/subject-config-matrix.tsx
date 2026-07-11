'use client';

import { Scale, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  SubjectConfigEditDialog,
  type SubjectConfigDraft,
} from '@/components/sis/subject-config-edit-dialog';
import {
  classifyProfile,
  PROFILE_CLASS,
  PROFILE_TEXT,
  ProfileLegendChip,
} from '@/components/sis/weight-profile';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Subject = {
  id: string;
  code: string;
  name: string;
  is_examinable: boolean;
};
type Level = { id: string; code: string; label: string; level_type?: string };
type Config = {
  id: string;
  subject_id: string;
  level_id: string;
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number;
};

// Per-AY subject weights matrix. Mirrors the visual language of the
// /sis/admin/template Subjects tab — card-per-subject with a chip row of
// (subject × level) profiles — but POSTs through the per-AY edit dialog
// instead of the template one. Edit-only here: per-AY (subject × level)
// CRUD belongs in the template's "Subject weights" tab, then propagated.
//
// The chip color → profile mapping (Primary 40·40·20 mint, Secondary
// 30·50·20 indigo, Custom amber, Invalid red) is shared with the template
// via `@/components/sis/weight-profile`.
export function SubjectConfigMatrix({
  subjects,
  levels,
  configs,
  ayCode,
}: {
  subjects: Subject[];
  levels: Level[];
  configs: Config[];
  ayCode: string;
}) {
  const [draft, setDraft] = useState<SubjectConfigDraft | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const byKey = useMemo(() => {
    const m = new Map<string, Config>();
    for (const c of configs) m.set(`${c.subject_id}|${c.level_id}`, c);
    return m;
  }, [configs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return subjects;
    return subjects.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
    );
  }, [subjects, query]);

  function openCell(subject: Subject, level: Level, config: Config) {
    setDraft({
      configId: config.id,
      subjectCode: subject.code,
      subjectName: subject.name,
      levelCode: level.code,
      levelLabel: level.label,
      ayCode,
      ww_weight: Math.round(config.ww_weight * 100),
      pt_weight: Math.round(config.pt_weight * 100),
      qa_weight: Math.round(config.qa_weight * 100),
      ww_max_slots: config.ww_max_slots,
      pt_max_slots: config.pt_max_slots,
      qa_max: config.qa_max,
    });
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Search + legend strip — same shape as the template's SubjectsTab
          header so the two surfaces read as one family. */}
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Find subject…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ProfileLegendChip profile="primary" label="Primary 40·40·20" />
            <ProfileLegendChip profile="secondary" label="Secondary 30·50·20" />
            <ProfileLegendChip profile="custom" label="Custom" />
            <ProfileLegendChip profile="invalid" label="Invalid · sum ≠ 100" />
          </div>
        </div>
        <div className="px-5 py-3 text-[12px] text-muted-foreground">
          Each chip is one (subject × level) weight config for{' '}
          <span className="font-mono font-semibold text-foreground">
            {ayCode}
          </span>
          . Click any chip to edit. A dashed cell means this AY doesn&apos;t
          have a config for that pair — add one via the template, then click{' '}
          <strong>Apply template</strong>.
        </div>
      </Card>

      {/* Subject cards */}
      {subjects.length === 0 && (
        <Card className="items-center py-12 text-center">
          <div className="flex flex-col items-center gap-3 px-6 py-2">
            <p className="text-sm text-muted-foreground">
              No subjects in catalogue. Add some in the template&apos;s Subjects
              tab first.
            </p>
          </div>
        </Card>
      )}

      {subjects.length > 0 && filtered.length === 0 && (
        <Card className="items-center py-10 text-center">
          <div className="flex flex-col items-center gap-2 px-6 py-2">
            <p className="text-sm text-muted-foreground">
              No subjects match &ldquo;{query}&rdquo;.
            </p>
          </div>
        </Card>
      )}

      {filtered.map((subject) => (
        <SubjectCard
          key={subject.id}
          subject={subject}
          levels={levels}
          configByKey={byKey}
          onOpenCell={openCell}
        />
      ))}

      <SubjectConfigEditDialog
        draft={draft}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

// =====================================================================
// Subject card — gradient header tile + chip row of (subject × level)
// profiles. Mirrors the template's SubjectCard so the two surfaces read
// as one family.
// =====================================================================

function SubjectCard({
  subject,
  levels,
  configByKey,
  onOpenCell,
}: {
  subject: Subject;
  levels: Level[];
  configByKey: Map<string, Config>;
  onOpenCell: (subject: Subject, level: Level, config: Config) => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <Scale className="size-4" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="h-6 border-border bg-card px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {subject.code}
            </Badge>
            <span className="font-serif text-[16px] font-semibold tracking-tight text-foreground">
              {subject.name}
            </span>
            {!subject.is_examinable && <Badge variant="muted">Non-exam</Badge>}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 p-4">
        {/* Per-AY surface: only render levels that actually have a config
            in this AY. Dashed/inert placeholders for missing pairs are
            noise here — adding a new (subject × level) is a template-side
            action, not a per-AY edit. Subjects with zero configs in this
            AY get an empty-state hint below. */}
        {(() => {
          const visibleLevels = levels.filter((l) =>
            configByKey.has(`${subject.id}|${l.id}`)
          );
          if (visibleLevels.length === 0) {
            return (
              <p className="px-1 py-1 text-[12px] text-muted-foreground">
                Not configured at any level in this AY. Enable in the template +
                click <strong>Apply template</strong>.
              </p>
            );
          }
          return visibleLevels.map((level) => {
            const cfg = configByKey.get(`${subject.id}|${level.id}`)!;
            const ww = Math.round(cfg.ww_weight * 100);
            const pt = Math.round(cfg.pt_weight * 100);
            const qa = Math.round(cfg.qa_weight * 100);
            const profile = classifyProfile(ww, pt, qa);
            return (
              <button
                key={level.id}
                type="button"
                onClick={() => onOpenCell(subject, level, cfg)}
                className={cn(
                  'inline-flex flex-col items-start gap-0.5 rounded-md px-3 py-1.5 transition-all',
                  'hover:-translate-y-0.5 hover:shadow-md',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40',
                  PROFILE_CLASS[profile]
                )}
                title={`${subject.name} · ${level.label} — ${ww}·${pt}·${qa} · slots ${cfg.ww_max_slots}/${cfg.pt_max_slots} · QA/${cfg.qa_max}. Click to edit.`}
              >
                <span
                  className={cn(
                    'font-serif text-[12px] font-semibold leading-tight tracking-tight',
                    PROFILE_TEXT[profile].code
                  )}
                >
                  {level.label}
                </span>
                <span
                  className={cn(
                    'font-mono text-[10px] tabular-nums',
                    PROFILE_TEXT[profile].ratio
                  )}
                >
                  {ww} · {pt} · {qa}
                </span>
              </button>
            );
          });
        })()}
      </div>
    </Card>
  );
}
