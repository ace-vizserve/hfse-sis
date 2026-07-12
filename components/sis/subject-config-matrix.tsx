'use client';

import { ChevronDown, Scale, Search, X } from 'lucide-react';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  computeTemplateDiff,
  type TemplateConfigField,
  type TemplateSubjectConfigRow,
} from '@/lib/sis/template-diff';

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

// Renders the ACTUAL grading-sheet columns a teacher would see (WW/PT slot
// count + QA denominator), matching the approved mockup's artifact-preview
// direction — this is the same information that was previously only in the
// chip's `title` tooltip (invisible at a glance).
export function GradingSheetPreview({
  config,
}: {
  config: Pick<Config, 'ww_max_slots' | 'pt_max_slots' | 'qa_max'>;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto py-1">
      {Array.from({ length: config.ww_max_slots }, (_, i) => (
        <div key={`ww${i}`} className="w-11 flex-none text-center">
          <div className="rounded-t-md bg-brand-sky/15 py-1 font-mono text-[9px] font-semibold uppercase text-brand-indigo-deep">
            WW{i + 1}
          </div>
          <div className="rounded-b-md border border-t-0 border-border bg-card py-1 font-mono text-[10px] text-ink-3">
            /10
          </div>
        </div>
      ))}
      <div className="w-2 flex-none" aria-hidden />
      {Array.from({ length: config.pt_max_slots }, (_, i) => (
        <div key={`pt${i}`} className="w-11 flex-none text-center">
          <div className="rounded-t-md bg-brand-mint/20 py-1 font-mono text-[9px] font-semibold uppercase text-ink">
            PT{i + 1}
          </div>
          <div className="rounded-b-md border border-t-0 border-border bg-card py-1 font-mono text-[10px] text-ink-3">
            /10
          </div>
        </div>
      ))}
      <div className="w-2 flex-none" aria-hidden />
      <div className="w-12 flex-none text-center">
        <div className="rounded-t-md bg-brand-amber-light py-1 font-mono text-[9px] font-semibold uppercase text-brand-amber">
          QA
        </div>
        <div className="rounded-b-md border border-t-0 border-border bg-card py-1 font-mono text-[10px] text-ink-3">
          /{config.qa_max}
        </div>
      </div>
    </div>
  );
}

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
  templateConfigs,
  ayCode,
}: {
  subjects: Subject[];
  levels: Level[];
  configs: Config[];
  templateConfigs: TemplateSubjectConfigRow[];
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

  // Structure Defaults tab — value drift only (weights/slots for subjects
  // that exist on BOTH sides), the complement of the presence-only gap
  // banner above this component (which flags subjects missing entirely).
  // Same diff engine Task 1/2 use for the template Propagate-to-AYs
  // preview; sections params are irrelevant here so [] / [] is passed,
  // matching the partial-call pattern already covered by that engine's
  // tests.
  const configChanges = useMemo(
    () => computeTemplateDiff(templateConfigs, configs, [], []).configChanges,
    [templateConfigs, configs]
  );

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
    <Tabs defaultValue="this-year">
      <TabsList variant="segmented" className="mt-2">
        <TabsTrigger value="this-year">This year</TabsTrigger>
        <TabsTrigger value="structure-defaults" className="gap-1.5">
          Structure Defaults
          {configChanges.length > 0 && (
            <span className="rounded-full bg-brand-amber-light px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-amber">
              {configChanges.length} drift
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="this-year" className="space-y-4">
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
              <ProfileLegendChip
                profile="secondary"
                label="Secondary 30·50·20"
              />
              <ProfileLegendChip profile="custom" label="Custom" />
              <ProfileLegendChip
                profile="invalid"
                label="Invalid · sum ≠ 100"
              />
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
                No subjects in catalogue. Add some in the template&apos;s
                Subjects tab first.
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
      </TabsContent>

      <TabsContent value="structure-defaults">
        <TemplateDriftList
          changes={configChanges}
          subjects={subjects}
          levels={levels}
        />
      </TabsContent>
    </Tabs>
  );
}

// =====================================================================
// Structure Defaults tab — value-drift list. Answers "for subjects that
// exist in both this AY and the template, do their weights/slots differ?"
// (the presence-gap banner on the page answers the complementary "is a
// subject missing entirely?" question). Same from→to chip visual language
// as the template's Propagate-to-AYs preview (template-manager-client.tsx).
// =====================================================================

const TEMPLATE_FIELD_LABEL: Record<TemplateConfigField, string> = {
  wwWeight: 'WW weight',
  ptWeight: 'PT weight',
  qaWeight: 'QA weight',
  wwMaxSlots: 'WW slots',
  ptMaxSlots: 'PT slots',
  qaMax: 'QA max',
};

function TemplateDriftList({
  changes,
  subjects,
  levels,
}: {
  changes: Array<{
    subjectId: string;
    levelId: string;
    field: TemplateConfigField;
    from: number;
    to: number;
  }>;
  subjects: Subject[];
  levels: Level[];
}) {
  const subjectById = useMemo(
    () => new Map(subjects.map((s) => [s.id, s])),
    [subjects]
  );
  const levelById = useMemo(
    () => new Map(levels.map((l) => [l.id, l])),
    [levels]
  );

  if (changes.length === 0) {
    return (
      <Card className="items-center py-10 text-center">
        <div className="flex flex-col items-center gap-2 px-6 py-2">
          <p className="text-sm text-muted-foreground">
            Every configured (subject × level) in this AY matches Structure
            Defaults — nothing has drifted.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="gap-0 py-0">
      <div className="border-b border-border px-5 py-4">
        <p className="text-[12px] text-muted-foreground">
          Values that differ from Structure Defaults for subjects configured in
          both places. To bring this AY back in line, use{' '}
          <strong>Propagate to AYs</strong> on the template.
        </p>
      </div>
      <div className="space-y-1.5 p-4">
        {changes.map((c, i) => {
          const subject = subjectById.get(c.subjectId);
          const level = levelById.get(c.levelId);
          return (
            <div
              key={`${c.subjectId}-${c.levelId}-${c.field}-${i}`}
              className="flex items-center gap-2 text-xs"
            >
              <Badge variant="warning">~ DRIFT</Badge>
              <span className="text-foreground">
                {subject?.code ?? c.subjectId} · {level?.label ?? c.levelId} ·{' '}
                {TEMPLATE_FIELD_LABEL[c.field]}
              </span>
              <span className="ml-auto flex items-center">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono line-through decoration-destructive/60">
                  {c.from}
                </span>
                <span className="mx-1 text-ink-5">→</span>
                <span className="rounded bg-brand-mint/20 px-1.5 py-0.5 font-mono text-ink">
                  {c.to}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </Card>
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
  // Which (subject × level) chips have their grading-sheet-column preview
  // expanded. Keyed by level id — scoped per-card since level ids are
  // unique within a subject's visible set.
  const [expandedLevelIds, setExpandedLevelIds] = useState<Set<string>>(
    new Set()
  );

  function togglePreview(levelId: string) {
    setExpandedLevelIds((prev) => {
      const next = new Set(prev);
      if (next.has(levelId)) next.delete(levelId);
      else next.add(levelId);
      return next;
    });
  }

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
            const isPreviewOpen = expandedLevelIds.has(level.id);
            return (
              <Collapsible
                key={level.id}
                open={isPreviewOpen}
                onOpenChange={() => togglePreview(level.id)}
              >
                {/* The chip is now two independent click targets sharing one
                    visual footprint: the original edit button (unchanged
                    onOpenCell behavior) plus a small caret that expands the
                    grading-sheet-column preview below. Hover-lift + profile
                    color live on the shared wrapper so the chip still reads
                    as one unit. */}
                <div
                  className={cn(
                    'inline-flex items-stretch overflow-hidden rounded-md transition-all',
                    'hover:-translate-y-0.5 hover:shadow-md',
                    PROFILE_CLASS[profile]
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpenCell(subject, level, cfg)}
                    className="inline-flex flex-col items-start gap-0.5 py-1.5 pl-3 pr-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
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
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'flex items-center self-stretch pl-1 pr-2 opacity-60 transition-opacity hover:opacity-100',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40'
                      )}
                      aria-label={`${isPreviewOpen ? 'Hide' : 'Show'} grading sheet columns for ${subject.name} · ${level.label}`}
                    >
                      <ChevronDown
                        className={cn(
                          'size-3.5 transition-transform',
                          PROFILE_TEXT[profile].code,
                          isPreviewOpen && 'rotate-180'
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <div className="mt-1 w-fit rounded-md border border-border bg-muted/20 px-2 py-1">
                    <GradingSheetPreview config={cfg} />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          });
        })()}
      </div>
    </Card>
  );
}
