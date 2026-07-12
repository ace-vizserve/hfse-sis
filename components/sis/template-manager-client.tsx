'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Eye,
  GraduationCap,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  Save,
  Scale,
  School,
  Search,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  useForm,
  type Control,
  type FieldValues,
  type Path,
} from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  SCHEDULE_LABELS,
  SCHEDULE_VALUES,
  SECTION_CLASS_TYPES,
  type Schedule,
  type SectionClassType,
} from '@/lib/schemas/section';
import {
  TemplateSectionCreateSchema,
  TemplateSectionUpdateSchema,
  TemplateSubjectConfigCreateSchema,
  TemplateSubjectConfigUpdateSchema,
  type TemplateSectionCreateInput,
  type TemplateSectionUpdateInput,
  type TemplateSubjectConfigCreateInput,
  type TemplateSubjectConfigUpdateInput,
} from '@/lib/schemas/template';
import {
  SubjectCreateSchema,
  type SubjectCreateInput,
} from '@/lib/schemas/subject';
import {
  classifyProfile,
  PROFILE_CLASS,
  PROFILE_LABEL,
  PROFILE_TEXT,
  ProfileLegendChip,
} from '@/components/sis/weight-profile';
import type {
  EligibleAyRow,
  TemplateSectionRow,
  TemplateSubjectConfigRow,
} from '@/lib/sis/template/queries';
import type { LevelRow, SubjectRow } from '@/lib/sis/subjects/queries';
import type {
  TemplateConfigField,
  TemplateDiff,
} from '@/lib/sis/template-diff';
import { cn } from '@/lib/utils';

type Props = {
  templateSections: TemplateSectionRow[];
  templateConfigs: TemplateSubjectConfigRow[];
  subjects: SubjectRow[];
  levels: LevelRow[];
  eligibleAys: EligibleAyRow[];
};

// Weight profile classification + chip styling lives in
// `@/components/sis/weight-profile` so /sis/admin/template and
// /sis/admin/subjects share one source of truth. Edit the recipe there.

export function TemplateManagerClient({
  templateSections,
  templateConfigs,
  subjects,
  levels,
  eligibleAys,
}: Props) {
  const hasTemplate = templateSections.length > 0 || templateConfigs.length > 0;
  const sectionLevelCount = useMemo(
    () => new Set(templateSections.map((s) => s.level_id)).size,
    [templateSections]
  );

  return (
    <>
      {/* Stats hero strip — at-a-glance summary + propagate CTA. */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Template at a glance
          </CardDescription>
          <CardTitle className="font-serif text-[20px] font-semibold tracking-tight text-foreground">
            {hasTemplate ? 'Master class structure' : 'Set up the template'}
          </CardTitle>
          <CardAction>
            <PropagateDialog
              eligibleAys={eligibleAys}
              disabled={!hasTemplate}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px] text-muted-foreground">
          <StatBlock
            label="Sections"
            value={templateSections.length}
            sub={`across ${sectionLevelCount} level${sectionLevelCount === 1 ? '' : 's'}`}
            icon={LayoutGrid}
          />
          <StatBlock
            label="Subject configs"
            value={templateConfigs.length}
            sub={`${subjects.length} subj × ${levels.length} levels`}
            icon={Scale}
          />
          {!hasTemplate && (
            <p className="ml-auto max-w-md text-right text-[12px] text-muted-foreground">
              The template is empty. Add sections and edit subject weights below
              — they become the starting point for every new AY.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Tabbed editor — Sections (rosters) · Subjects (catalog) ·
          Subject weights (matrix). Catalog and matrix are different
          concepts: catalog is "what subjects exist," matrix is "what's
          taught at each level." */}
      <Tabs defaultValue="sections" className="space-y-5">
        <TabsList className="grid w-full grid-cols-3 sm:max-w-2xl">
          <TabsTrigger value="sections" className="gap-2">
            <School className="size-3.5" />
            Sections
          </TabsTrigger>
          <TabsTrigger value="subjects" className="gap-2">
            <BookOpen className="size-3.5" />
            Subjects
          </TabsTrigger>
          <TabsTrigger value="weights" className="gap-2">
            <Scale className="size-3.5" />
            Subject weights
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sections" className="space-y-5">
          <SectionsTab sections={templateSections} levels={levels} />
        </TabsContent>

        <TabsContent value="subjects" className="space-y-5">
          <SubjectsCatalogTab subjects={subjects} configs={templateConfigs} />
        </TabsContent>

        <TabsContent value="weights" className="space-y-5">
          <SubjectsTab
            configs={templateConfigs}
            subjects={subjects}
            levels={levels}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function StatBlock({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: number;
  sub: string;
  icon: typeof LayoutGrid;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <Icon className="size-4" />
      </div>
      <div className="leading-tight">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        <p className="font-serif text-[22px] font-semibold tabular-nums text-foreground">
          {value.toLocaleString('en-SG')}
          <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">
            {sub}
          </span>
        </p>
      </div>
    </div>
  );
}

// =====================================================================
// Sections tab — grouped pill rows by level
// =====================================================================

function SectionsTab({
  sections,
  levels,
}: {
  sections: TemplateSectionRow[];
  levels: LevelRow[];
}) {
  // Group sections by level_id, ordered by the canonical levels list.
  const sectionsByLevel = useMemo(() => {
    const map = new Map<string, TemplateSectionRow[]>();
    for (const s of sections) {
      const arr = map.get(s.level_id) ?? [];
      arr.push(s);
      map.set(s.level_id, arr);
    }
    for (const arr of map.values())
      arr.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [sections]);

  const levelsWithSections = levels.filter(
    (l) => sectionsByLevel.has(l.id) || true
  );

  return (
    <div className="space-y-4">
      {sections.length === 0 && (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Sparkles className="size-5" />
            </div>
            <div className="font-serif text-lg font-semibold text-foreground">
              No template sections yet
            </div>
            <p className="max-w-md text-sm text-muted-foreground">
              Add your first section below — every level you populate becomes
              part of the starting structure for every new AY.
            </p>
          </CardContent>
        </Card>
      )}

      {levelsWithSections.map((level) => {
        const levelSections = sectionsByLevel.get(level.id) ?? [];
        return (
          <LevelGroup
            key={level.id}
            level={level}
            sections={levelSections}
            allLevels={levels}
          />
        );
      })}
    </div>
  );
}

function LevelGroup({
  level,
  sections,
  allLevels,
}: {
  level: LevelRow;
  sections: TemplateSectionRow[];
  allLevels: LevelRow[];
}) {
  return (
    <Card className="@container/card gap-0 py-0 overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-3">
        <Badge
          variant="outline"
          className="h-6 border-border bg-card px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
        >
          {level.code}
        </Badge>
        <div className="font-serif text-[15px] font-semibold tracking-tight text-foreground">
          {level.label}
        </div>
        <Badge variant="muted" className="ml-auto">
          {sections.length} section{sections.length === 1 ? '' : 's'}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2 p-4">
        {sections.map((s) => (
          <SectionPill key={s.id} section={s} />
        ))}
        <AddSectionPill levelId={level.id} levels={allLevels} />
      </div>
    </Card>
  );
}

function SectionPill({ section }: { section: TemplateSectionRow }) {
  return (
    <div className="group/pill inline-flex items-center gap-2.5 rounded-xl border border-hairline bg-gradient-to-b from-card to-muted/20 py-2 pl-2.5 pr-1.5 shadow-xs transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-md">
      <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <GraduationCap className="size-3.5" />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="font-serif text-[14px] font-semibold tracking-tight text-foreground">
          {section.name}
        </span>
        <span className="flex items-center gap-1.5">
          {section.class_type && (
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              {section.class_type}
            </span>
          )}
          {section.schedule && (
            <Badge
              variant="outline"
              className="h-4 border-brand-indigo/30 bg-brand-indigo/10 px-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-brand-indigo"
            >
              {SCHEDULE_LABELS[section.schedule as Schedule]}
            </Badge>
          )}
        </span>
      </div>
      <div className="ml-1 flex items-center gap-0.5 opacity-60 transition-opacity group-hover/pill:opacity-100">
        <EditTemplateSectionButton section={section} compact />
        <DeleteTemplateSectionButton section={section} compact />
      </div>
    </div>
  );
}

function AddSectionPill({
  levelId,
  levels,
}: {
  levelId: string;
  levels: LevelRow[];
}) {
  return (
    <NewTemplateSectionButton levels={levels} defaultLevelId={levelId}>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-xl border border-dashed border-border bg-transparent px-3.5 py-2.5 text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:bg-muted/30 hover:text-foreground hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
      >
        <Plus className="size-3.5" />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em]">
          Add section
        </span>
      </button>
    </NewTemplateSectionButton>
  );
}

// =====================================================================
// Subjects tab — searchable subject list with compact level chips
// =====================================================================

type ConfigDraft = {
  configId: string;
  subjectCode: string;
  subjectName: string;
  levelCode: string;
  levelLabel: string;
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number;
};

function SubjectsTab({
  configs,
  subjects,
  levels,
}: {
  configs: TemplateSubjectConfigRow[];
  subjects: SubjectRow[];
  levels: LevelRow[];
}) {
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Dashed-cell create flow — opens a separate POST dialog. Decoupled from
  // the edit dialog state so the two never race; clicking a chip opens
  // edit, clicking a dashed cell opens create.
  const [createSubject, setCreateSubject] = useState<SubjectRow | null>(null);
  const [createLevel, setCreateLevel] = useState<LevelRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  function openCreate(subject: SubjectRow, level: LevelRow) {
    if ((level.level_type as string) === 'preschool') return; // Markbook excludes preschool.
    setCreateSubject(subject);
    setCreateLevel(level);
    setCreateOpen(true);
  }

  const byKey = useMemo(() => {
    const m = new Map<string, TemplateSubjectConfigRow>();
    for (const c of configs) m.set(`${c.subject_id}|${c.level_id}`, c);
    return m;
  }, [configs]);

  const filteredSubjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return subjects;
    return subjects.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
    );
  }, [subjects, query]);

  function openCell(
    subject: SubjectRow,
    level: LevelRow,
    config: TemplateSubjectConfigRow
  ) {
    setDraft({
      configId: config.id,
      subjectCode: subject.code,
      subjectName: subject.name,
      levelCode: level.code,
      levelLabel: level.label,
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
      {/* Search + legend strip */}
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
            <ProfileLegendChip profile="primary" label="Primary" />
            <ProfileLegendChip profile="secondary" label="Secondary" />
            <ProfileLegendChip profile="custom" label="Custom" />
            <ProfileLegendChip profile="invalid" label="Invalid" />
          </div>
        </div>
        <div className="px-5 py-3 text-[12px] text-muted-foreground">
          Each chip below is one (subject × level) weight profile. Click any
          chip to edit. The color tells you at a glance which profile that pair
          uses — Primary 40·40·20, Secondary 30·50·20, anything else is Custom.
        </div>
      </Card>

      {/* Subject cards */}
      {subjects.length === 0 && (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground">
              No subjects configured. Seed them via SQL first, then return here.
            </p>
          </CardContent>
        </Card>
      )}

      {subjects.length > 0 && filteredSubjects.length === 0 && (
        <Card className="items-center py-10 text-center">
          <CardContent className="flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground">
              No subjects match &ldquo;{query}&rdquo;.
            </p>
          </CardContent>
        </Card>
      )}

      {filteredSubjects.map((subject) => (
        <SubjectCard
          key={subject.id}
          subject={subject}
          levels={levels}
          configByKey={byKey}
          onOpenCell={openCell}
          onOpenCreate={openCreate}
        />
      ))}

      <TemplateSubjectConfigEditDialog
        draft={draft}
        open={open}
        onOpenChange={setOpen}
      />
      <TemplateSubjectConfigCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        subject={createSubject}
        level={createLevel}
      />
    </div>
  );
}

function SubjectCard({
  subject,
  levels,
  configByKey,
  onOpenCell,
  onOpenCreate,
}: {
  subject: SubjectRow;
  levels: LevelRow[];
  configByKey: Map<string, TemplateSubjectConfigRow>;
  onOpenCell: (
    subject: SubjectRow,
    level: LevelRow,
    config: TemplateSubjectConfigRow
  ) => void;
  onOpenCreate: (subject: SubjectRow, level: LevelRow) => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <Scale className="size-4" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-2">
            <span className="font-serif text-[16px] font-semibold tracking-tight text-foreground">
              {subject.name}
            </span>
            {!subject.is_examinable && <Badge variant="muted">Non-exam</Badge>}
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {subject.code}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 p-4">
        {/* Hide empty cells (preschool + not-yet-enabled markbook levels)
            so the chip row only shows what's actually configured. The
            "+ Add level" picker at the end takes the dashed-cell affordance
            and turns it into a single contextual menu listing every
            markbook-eligible level not yet enabled for this subject. */}
        {(() => {
          const markbookLevels = levels.filter(
            (l) => (l.level_type as string) !== 'preschool'
          );
          const visibleLevels = markbookLevels.filter((l) =>
            configByKey.has(`${subject.id}|${l.id}`)
          );
          const availableLevels = markbookLevels.filter(
            (l) => !configByKey.has(`${subject.id}|${l.id}`)
          );
          return (
            <>
              {visibleLevels.length === 0 && availableLevels.length > 0 && (
                <p className="px-1 py-1 text-[12px] text-muted-foreground">
                  Not enabled at any level yet. Click{' '}
                  <strong>+ Add level</strong> to start.
                </p>
              )}
              {visibleLevels.length === 0 && availableLevels.length === 0 && (
                <p className="px-1 py-1 text-[12px] text-muted-foreground">
                  No markbook levels available (only preschool levels exist).
                </p>
              )}
              {visibleLevels.map((level) => {
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
                    title={`${subject.name} · ${level.label} — ${PROFILE_LABEL[profile]} (WW ${ww} · PT ${pt} · QA ${qa}). Click to edit.`}
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
              })}
              {availableLevels.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-all',
                        'hover:-translate-y-0.5 hover:border-brand-indigo/60 hover:bg-accent/40 hover:text-foreground hover:shadow-md',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40'
                      )}
                      title={`Enable ${subject.name} at a new level`}
                    >
                      <Plus className="size-3.5" />
                      Add level
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuLabel>
                      Enable {subject.code} at…
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {availableLevels.map((level) => (
                      <DropdownMenuItem
                        key={level.id}
                        onSelect={() => onOpenCreate(subject, level)}
                        className="gap-2"
                      >
                        <Badge
                          variant="outline"
                          className="h-5 border-border bg-card px-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-foreground"
                        >
                          {level.code}
                        </Badge>
                        <span className="font-serif text-[13px] font-medium">
                          {level.label}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          );
        })()}
      </div>
    </Card>
  );
}

// =====================================================================
// Propagate-to-AYs dialog
// =====================================================================

const TEMPLATE_FIELD_LABEL: Record<TemplateConfigField, string> = {
  wwWeight: 'WW weight',
  ptWeight: 'PT weight',
  qaWeight: 'QA weight',
  wwMaxSlots: 'WW slots',
  ptMaxSlots: 'PT slots',
  qaMax: 'QA max',
};

function PropagateDialog({
  eligibleAys,
  disabled,
}: {
  eligibleAys: EligibleAyRow[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewAyCode, setPreviewAyCode] = useState<string | null>(null);

  const allSelected =
    eligibleAys.length > 0 && selected.size === eligibleAys.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll(checked: boolean) {
    setSelected(
      checked ? new Set(eligibleAys.map((a) => a.ay_code)) : new Set()
    );
  }
  function toggleOne(ayCode: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(ayCode);
      else next.delete(ayCode);
      return next;
    });
  }

  // Read-only preview (Task 2) — computed the same way the apply RPC would
  // resolve the UPSERT, but never writes. Re-fetches whenever the previewed
  // AY changes; `enabled` keeps it idle until a row's "Preview" is clicked.
  const diffQuery = useQuery({
    queryKey: ['template-diff', previewAyCode],
    queryFn: () =>
      apiFetch<{ diff: TemplateDiff }>(
        `/api/sis/admin/template/diff?ay_code=${previewAyCode}`
      ),
    enabled: !!previewAyCode,
  });
  const diff = diffQuery.data?.diff;
  const changeCount = diff
    ? diff.newSections.length +
      diff.newConfigs.length +
      diff.configChanges.length
    : 0;

  type ApplyResult = {
    ok?: boolean;
    results?: Array<{
      ay_code: string;
      sections_inserted: number;
      sections_updated: number;
      configs_inserted: number;
      configs_updated: number;
    }>;
    failures?: Array<{ ay_code: string; error: string }>;
    error?: string;
  };

  // Tier-2 mutation: useMutation owns the pending/error UX. The bespoke
  // success-body handling (results → summary; failures → toast.warning vs
  // toast.success) is preserved exactly. Task 2 only adds a preview step in
  // front of this — the mutation itself, its request shape, and its
  // success/error handling are unchanged.
  const applyMutation = useMutation({
    mutationFn: (ayCodes: string[]) =>
      apiFetch<ApplyResult>(
        '/api/sis/admin/template/apply',
        jsonInit('POST', { ay_codes: ayCodes })
      ),
    onSuccess: (body) => {
      const summary = (body.results ?? [])
        .map((r) => {
          const secTotal = r.sections_inserted + r.sections_updated;
          const cfgTotal = r.configs_inserted + r.configs_updated;
          return `${r.ay_code} (${secTotal} section${secTotal === 1 ? '' : 's'}, ${cfgTotal} config${cfgTotal === 1 ? '' : 's'})`;
        })
        .join(' · ');
      const fails = body.failures ?? [];
      if (fails.length > 0) {
        toast.warning(
          `Partial: ${summary || 'no successes'} · failed: ${fails.map((f) => f.ay_code).join(', ')}`
        );
      } else {
        toast.success(`Propagated to ${summary || 'no AYs'}`);
      }
      setOpen(false);
      setSelected(new Set());
      setPreviewAyCode(null);
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'apply failed');
    },
  });

  function onConfirm() {
    if (selected.size === 0) return;
    applyMutation.mutate(Array.from(selected));
  }

  function onConfirmPreview() {
    if (!previewAyCode) return;
    applyMutation.mutate([previewAyCode]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSelected(new Set());
          setPreviewAyCode(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled} className="gap-1.5">
          <Send className="size-3.5" />
          Propagate to AYs…
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Propagate template</DialogTitle>
          <DialogDescription>
            Adds any missing entries and updates changed values. Nothing is ever
            deleted, and year-specific data (such as the form-class adviser) is
            preserved.
          </DialogDescription>
        </DialogHeader>

        {eligibleAys.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            No non-test AYs to propagate to.
          </div>
        ) : (
          <div className="space-y-2">
            <label className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              <Checkbox
                checked={
                  allSelected ? true : someSelected ? 'indeterminate' : false
                }
                onCheckedChange={(c) => toggleAll(c === true)}
              />
              <span className="font-medium text-foreground">Select all</span>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                {selected.size}/{eligibleAys.length}
              </span>
            </label>
            <div className="space-y-1">
              {eligibleAys.map((ay) => (
                <div
                  key={ay.ay_code}
                  className="flex items-center gap-1 rounded-md px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <label className="flex flex-1 cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={selected.has(ay.ay_code)}
                      onCheckedChange={(c) => toggleOne(ay.ay_code, c === true)}
                    />
                    <span className="font-mono text-xs font-semibold text-foreground">
                      {ay.ay_code}
                    </span>
                    <span className="text-muted-foreground">{ay.label}</span>
                    {ay.is_current && (
                      <Badge variant="muted" className="ml-auto">
                        Current
                      </Badge>
                    )}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 shrink-0 gap-1 px-2 text-xs',
                      previewAyCode === ay.ay_code && 'bg-muted text-foreground'
                    )}
                    onClick={() => setPreviewAyCode(ay.ay_code)}
                  >
                    <Eye className="size-3.5" />
                    Preview
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {previewAyCode && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Preview — {previewAyCode}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs"
                aria-label="Dismiss preview"
                onClick={() => setPreviewAyCode(null)}
              >
                <X className="size-3" />
              </Button>
            </div>

            {diffQuery.isLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Computing changes…
              </div>
            ) : diffQuery.isError ? (
              <div className="flex items-center gap-2 py-2 text-sm text-destructive">
                <AlertCircle className="size-3.5" />
                {diffQuery.error instanceof Error
                  ? diffQuery.error.message
                  : 'Could not load the preview.'}
              </div>
            ) : !diff ? null : changeCount === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                {previewAyCode} already matches the template — nothing to apply.
              </p>
            ) : (
              <div className="max-h-56 space-y-1.5 overflow-y-auto">
                {diff.newSections.map((s, i) => (
                  <div
                    key={`sec-${i}`}
                    className="flex items-center gap-2 text-xs"
                  >
                    <Badge variant="success">+ NEW</Badge>
                    <span className="text-foreground">
                      Section <span className="font-medium">{s.name}</span> (
                      {s.levelId})
                    </span>
                  </div>
                ))}
                {diff.newConfigs.map((c, i) => (
                  <div
                    key={`cfg-${i}`}
                    className="flex items-center gap-2 text-xs"
                  >
                    <Badge variant="success">+ NEW</Badge>
                    <span className="text-foreground">
                      Subject config{' '}
                      <span className="font-medium">{c.subjectId}</span> (
                      {c.levelId})
                    </span>
                  </div>
                ))}
                {diff.configChanges.map((c, i) => (
                  <div
                    key={`chg-${i}`}
                    className="flex items-center gap-2 text-xs"
                  >
                    <Badge variant="warning">~ UPDATE</Badge>
                    <span className="text-foreground">
                      {c.subjectId} ({c.levelId}) ·{' '}
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
                ))}
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Apply never removes. If a section or subject was deleted from the
              template, it stays in {previewAyCode} untouched — remove it there
              directly.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          {previewAyCode ? (
            <Button
              type="button"
              onClick={onConfirmPreview}
              disabled={
                diffQuery.isLoading ||
                applyMutation.isPending ||
                changeCount === 0
              }
              className="gap-1.5"
            >
              {applyMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              {applyMutation.isPending
                ? 'Applying…'
                : `Apply ${changeCount} change${changeCount === 1 ? '' : 's'} to ${previewAyCode}`}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onConfirm}
              disabled={selected.size === 0 || applyMutation.isPending}
              className="gap-1.5"
            >
              {applyMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              {applyMutation.isPending
                ? 'Propagating…'
                : `Propagate to ${selected.size}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Section CRUD dialogs (preserved from original — entry triggers
// updated to fit the new pill UI)
// =====================================================================

const BLANK_SECTION: TemplateSectionCreateInput = {
  name: '',
  level_id: '',
  class_type: null,
  schedule: null,
};

// Sentinel for the shadcn Select's clear-to-None option, since an empty
// string value isn't allowed as a SelectItem value.
const SCHEDULE_NONE = '__none__';

// Shared Schedule <Select> field for the create + edit section dialogs.
// Both TemplateSectionCreateInput and TemplateSectionUpdateInput carry a
// nullable `schedule`; generic over the form shape so each dialog's
// Control type is accepted (RHF's Control is invariant).
function ScheduleFormField<T extends FieldValues>({
  control,
}: {
  control: Control<T>;
}) {
  return (
    <FormField
      control={control}
      name={'schedule' as Path<T>}
      render={({ field }) => (
        <FormItem>
          <FormLabel>Schedule</FormLabel>
          <Select
            value={field.value ?? SCHEDULE_NONE}
            onValueChange={(v) =>
              field.onChange(v === SCHEDULE_NONE ? null : (v as Schedule))
            }
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value={SCHEDULE_NONE}>None</SelectItem>
              {SCHEDULE_VALUES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SCHEDULE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function NewTemplateSectionButton({
  levels,
  defaultLevelId,
  children,
}: {
  levels: LevelRow[];
  defaultLevelId?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<TemplateSectionCreateInput>({
    resolver: zodResolver(TemplateSectionCreateSchema),
    defaultValues: { ...BLANK_SECTION, level_id: defaultLevelId ?? '' },
  });

  // Re-seed the form whenever the dialog opens with a different default level
  // (i.e. user clicked "Add section" inside Primary One vs Primary Two).
  useEffect(() => {
    if (open) {
      form.reset({ ...BLANK_SECTION, level_id: defaultLevelId ?? '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultLevelId]);

  // Tier-2 mutation; mutateAsync is awaited inside the RHF submit handler so
  // form.formState.isSubmitting drives the busy UX.
  const createMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      level_id: string;
      class_type: SectionClassType | null;
      schedule: Schedule | null;
    }) =>
      apiFetch('/api/sis/admin/template/sections', jsonInit('POST', payload)),
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'create failed');
    },
  });

  async function onSubmit(values: TemplateSectionCreateInput) {
    try {
      await createMutation.mutateAsync({
        name: values.name.trim(),
        level_id: values.level_id,
        class_type: values.class_type ?? null,
        schedule: values.schedule ?? null,
      });
      toast.success(`Added ${values.name} to template`);
      setOpen(false);
      form.reset({ ...BLANK_SECTION, level_id: defaultLevelId ?? '' });
      router.refresh();
    } catch {
      // onError already surfaced the toast.
    }
  }

  const busy = form.formState.isSubmitting;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next)
          form.reset({ ...BLANK_SECTION, level_id: defaultLevelId ?? '' });
      }}
    >
      <DialogTrigger asChild>
        {children ?? (
          <Button size="sm" className="gap-1.5">
            <Plus className="size-3.5" />
            Add section
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add template section</DialogTitle>
          <DialogDescription>
            Saves to the master template only. Existing AYs aren&apos;t affected
            until you propagate.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="level_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Level</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a level" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {levels.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          <span className="font-mono text-xs">{l.code}</span>
                          <span className="ml-2 text-muted-foreground">
                            {l.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Section name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Patience"
                      {...field}
                      autoCapitalize="words"
                    />
                  </FormControl>
                  <FormDescription>
                    Just the virtue / label. Level prefix is added automatically
                    on display.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="class_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Class type</FormLabel>
                  <Select
                    value={field.value ?? ''}
                    onValueChange={(v) =>
                      field.onChange(v === '' ? null : (v as SectionClassType))
                    }
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Optional" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SECTION_CLASS_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ScheduleFormField control={form.control} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy} className="gap-1.5">
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                {busy ? 'Adding…' : 'Add to template'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EditTemplateSectionButton({
  section,
  compact,
}: {
  section: TemplateSectionRow;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<TemplateSectionUpdateInput>({
    resolver: zodResolver(TemplateSectionUpdateSchema),
    defaultValues: {
      name: section.name,
      class_type: (section.class_type as SectionClassType | null) ?? null,
      schedule: (section.schedule as Schedule | null) ?? null,
    },
  });

  useEffect(() => {
    form.reset({
      name: section.name,
      class_type: (section.class_type as SectionClassType | null) ?? null,
      schedule: (section.schedule as Schedule | null) ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id, section.name, section.class_type, section.schedule]);

  // Tier-2 mutation; mutateAsync awaited inside the RHF submit handler so
  // form.formState.isSubmitting drives the busy UX.
  const saveMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      class_type: SectionClassType | null;
      schedule: Schedule | null;
    }) =>
      apiFetch(
        `/api/sis/admin/template/sections/${section.id}`,
        jsonInit('PATCH', payload)
      ),
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'save failed');
    },
  });

  async function onSubmit(values: TemplateSectionUpdateInput) {
    try {
      await saveMutation.mutateAsync({
        name: values.name.trim(),
        class_type: values.class_type ?? null,
        schedule: values.schedule ?? null,
      });
      toast.success(`Updated ${values.name}`);
      setOpen(false);
      router.refresh();
    } catch {
      // onError already surfaced the toast.
    }
  }

  const busy = form.formState.isSubmitting;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={`Edit ${section.name}`}
          >
            <Pencil className="size-3.5" />
          </button>
        ) : (
          <Button size="sm" variant="outline" className="gap-1.5">
            <Pencil className="size-3.5" />
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit template section</DialogTitle>
          <DialogDescription>
            Updates the master template. Use Propagate to push to existing AYs.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Section name</FormLabel>
                  <FormControl>
                    <Input {...field} autoCapitalize="words" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="class_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Class type</FormLabel>
                  <Select
                    value={field.value ?? ''}
                    onValueChange={(v) =>
                      field.onChange(v === '' ? null : (v as SectionClassType))
                    }
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Optional" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SECTION_CLASS_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ScheduleFormField control={form.control} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy} className="gap-1.5">
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTemplateSectionButton({
  section,
  compact,
}: {
  section: TemplateSectionRow;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Tier-2 body-less DELETE.
  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/sis/admin/template/sections/${section.id}`,
        jsonInit('DELETE')
      ),
    onSuccess: () => {
      toast.success(`Removed ${section.name} from template`);
      setOpen(false);
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'delete failed');
    },
  });

  function onConfirm() {
    deleteMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Remove ${section.name}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove from template?</DialogTitle>
          <DialogDescription>
            This removes <strong>{section.name}</strong> ({section.level_label})
            from the master template. Existing AYs keep their per-AY copy —
            propagation never deletes. Future AYs won&apos;t include this
            section.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={deleteMutation.isPending}
            className="gap-1.5"
          >
            {deleteMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            {deleteMutation.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Subject config edit dialog (preserved from original)
// =====================================================================

function TemplateSubjectConfigEditDialog({
  draft,
  open,
  onOpenChange,
}: {
  draft: ConfigDraft | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [ww, setWw] = useState('40');
  const [pt, setPt] = useState('40');
  const [qa, setQa] = useState('20');
  const [wwSlots, setWwSlots] = useState('5');
  const [ptSlots, setPtSlots] = useState('5');
  const [qaMax, setQaMax] = useState('30');
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!draft) return;
    setWw(String(draft.ww_weight));
    setPt(String(draft.pt_weight));
    setQa(String(draft.qa_weight));
    setWwSlots(String(draft.ww_max_slots));
    setPtSlots(String(draft.pt_max_slots));
    setQaMax(String(draft.qa_max));
  }, [draft]);

  // Reset confirm-remove flow whenever the dialog closes/reopens.
  useEffect(() => {
    if (!open) setConfirmRemove(false);
  }, [open]);

  // Tier-2 body-less DELETE. The original branched on the non-ok body:
  // `body.error ?? \`Remove failed (${status})\``. ApiError.message already
  // resolves to body.error when present; when absent we reconstruct the exact
  // status fallback from ApiError.status so the copy is preserved.
  const removeMutation = useMutation({
    mutationFn: (configId: string) =>
      apiFetch(
        `/api/sis/admin/template/subject-configs/${configId}`,
        jsonInit('DELETE')
      ),
    onSuccess: () => {
      toast.success(`Removed ${draft?.subjectName} from ${draft?.levelLabel}`);
      onOpenChange(false);
      router.refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const bodyError = (e.body as { error?: string } | null)?.error;
        toast.error(bodyError ?? `Remove failed (${e.status})`);
        return;
      }
      toast.error(e instanceof Error ? e.message : 'remove failed');
    },
  });

  function remove() {
    if (!draft) return;
    removeMutation.mutate(draft.configId);
  }

  const removing = removeMutation.isPending;

  const wwN = Number(ww) || 0;
  const ptN = Number(pt) || 0;
  const qaN = Number(qa) || 0;
  const sum = wwN + ptN + qaN;
  const sumOk = sum === 100;

  const parsed = TemplateSubjectConfigUpdateSchema.safeParse({
    ww_weight: wwN,
    pt_weight: ptN,
    qa_weight: qaN,
    ww_max_slots: Number(wwSlots) || 0,
    pt_max_slots: Number(ptSlots) || 0,
    qa_max: Number(qaMax) || 0,
  });

  // Tier-2 PATCH. The success toast reads several draft/local fields, so it's
  // built inside save() and passed through to onSuccess via a closure-captured
  // message; the network call is the only thing the mutation owns.
  const saveMutation = useMutation({
    mutationFn: (vars: {
      configId: string;
      payload: TemplateSubjectConfigUpdateInput;
    }) =>
      apiFetch(
        `/api/sis/admin/template/subject-configs/${vars.configId}`,
        jsonInit('PATCH', vars.payload)
      ),
    onSuccess: () => {
      toast.success(
        `${draft?.subjectName} · ${draft?.levelCode}: ${wwN}·${ptN}·${qaN} · QA/${Number(qaMax)}`
      );
      onOpenChange(false);
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'save failed');
    },
  });

  function save() {
    if (!draft || !parsed.success) {
      if (!parsed.success)
        toast.error(parsed.error.issues[0]?.message ?? 'Invalid values');
      return;
    }
    saveMutation.mutate({ configId: draft.configId, payload: parsed.data });
  }

  const saving = saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl!">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Scale className="size-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {draft ? `Template · ${draft.levelLabel}` : 'Subject weights'}
              </p>
              <DialogTitle className="font-serif text-xl font-semibold leading-tight tracking-tight text-foreground">
                {draft
                  ? `${draft.subjectName} · ${draft.levelCode}`
                  : 'Subject weights'}
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
                Updates the master template only. Use Propagate to push the new
                weights into existing AYs.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {draft && (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <div className="flex items-center gap-3 tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-sm bg-chart-3" /> WW {wwN}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-sm bg-brand-indigo" /> PT{' '}
                    {ptN}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-sm bg-brand-amber" /> QA{' '}
                    {qaN}
                  </span>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 font-semibold',
                    sumOk ? 'text-ink' : 'text-destructive'
                  )}
                >
                  {sumOk ? (
                    <CheckCircle2 className="size-3" />
                  ) : (
                    <AlertCircle className="size-3" />
                  )}
                  <span className="tabular-nums">{sum}%</span>
                </span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                {wwN > 0 && (
                  <div
                    className="bg-chart-3 transition-[flex-basis] duration-200"
                    style={{
                      flexBasis: `${(wwN / Math.max(sum, 100)) * 100}%`,
                    }}
                  />
                )}
                {ptN > 0 && (
                  <div
                    className="bg-brand-indigo transition-[flex-basis] duration-200"
                    style={{
                      flexBasis: `${(ptN / Math.max(sum, 100)) * 100}%`,
                    }}
                  />
                )}
                {qaN > 0 && (
                  <div
                    className="bg-brand-amber transition-[flex-basis] duration-200"
                    style={{
                      flexBasis: `${(qaN / Math.max(sum, 100)) * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Weights
              </p>
              <div className="grid grid-cols-3 gap-3">
                <PercentField
                  label="WW"
                  sublabel="Written Works"
                  value={ww}
                  setValue={setWw}
                />
                <PercentField
                  label="PT"
                  sublabel="Perf. Tasks"
                  value={pt}
                  setValue={setPt}
                />
                <PercentField
                  label="QA"
                  sublabel="Quarterly"
                  value={qa}
                  setValue={setQa}
                />
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Must sum to 100%. Canonical HFSE: Primary 40·40·20, Secondary
                30·50·20.
              </p>
            </div>

            <div className="space-y-2 border-t border-hairline pt-4">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Max slots
              </p>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="WW slots"
                  value={wwSlots}
                  setValue={setWwSlots}
                  maxDigits={1}
                />
                <NumberField
                  label="PT slots"
                  value={ptSlots}
                  setValue={setPtSlots}
                  maxDigits={1}
                />
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Hard cap 5 per KD #5.
              </p>
            </div>

            <div className="space-y-2 border-t border-hairline pt-4">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                QA max score
              </p>
              <div className="max-w-[160px]">
                <NumberField
                  label="Max score"
                  value={qaMax}
                  setValue={setQaMax}
                  maxDigits={3}
                />
              </div>
            </div>
          </div>
        )}

        {/* Footer with destructive "Remove from this level" action on the
            left + Save/Cancel on the right. The remove flow is two-step
            (click → inline confirm → click again to commit) so a stray
            click doesn't drop a config. */}
        <DialogFooter className="sm:justify-between">
          {confirmRemove ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={remove}
                disabled={removing}
                className="gap-1.5"
              >
                {removing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                {removing ? 'Removing…' : 'Confirm remove'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmRemove(false)}
                disabled={removing}
              >
                Keep
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmRemove(true)}
              disabled={!draft || saving || removing}
              className="gap-1.5 text-muted-foreground hover:text-destructive"
              title="Remove this (subject × level) from the template"
            >
              <Trash2 className="size-3.5" />
              Remove from this level
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={!draft || saving || removing || !parsed.success}
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              {saving ? 'Saving…' : 'Save weights'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PercentField({
  label,
  sublabel,
  value,
  setValue,
}: {
  label: string;
  sublabel: string;
  value: string;
  setValue: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="flex items-baseline gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <span className="font-semibold text-foreground">{label}</span>
        <span className="text-muted-foreground">· {sublabel}</span>
      </Label>
      <div className="relative">
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) =>
            setValue(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))
          }
          className="h-10 pr-7 text-right font-mono text-[15px] font-semibold tabular-nums"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-muted-foreground">
          %
        </span>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  setValue,
  maxDigits,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  maxDigits: number;
}) {
  return (
    <div className="space-y-1">
      <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </Label>
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) =>
          setValue(e.target.value.replace(/[^0-9]/g, '').slice(0, maxDigits))
        }
        className="h-10 text-right font-mono text-[15px] font-semibold tabular-nums"
      />
    </div>
  );
}

// =====================================================================
// Subjects catalog tab — list view of public.subjects + add new button
// + per-row "Drop from all levels" helper. Catalog management distinct
// from the matrix (Subject weights tab) which lives separately.
// =====================================================================

function SubjectsCatalogTab({
  subjects,
  configs,
}: {
  subjects: SubjectRow[];
  configs: TemplateSubjectConfigRow[];
}) {
  const [query, setQuery] = useState('');

  // Per-subject count of (subject × level) configs in the template — drives
  // the "Used at N levels" subtext and gates the "Drop from all levels"
  // button (only visible when count > 0).
  const configCountBySubject = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of configs)
      m.set(c.subject_id, (m.get(c.subject_id) ?? 0) + 1);
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

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => a.code.localeCompare(b.code)),
    [filtered]
  );

  return (
    <div className="space-y-4">
      {/* Header strip — search + add */}
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
          <NewSubjectButton />
        </div>
        <div className="px-5 py-3 text-[12px] text-muted-foreground">
          The global catalogue of subjects HFSE teaches. Add a new subject here,
          then enable it at the levels where it&apos;s taught via the{' '}
          <strong>Subject weights</strong> tab.
        </div>
      </Card>

      {/* Empty + no-results states */}
      {subjects.length === 0 && (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <BookOpen className="size-5" />
            </div>
            <div className="font-serif text-lg font-semibold text-foreground">
              No subjects in catalogue yet
            </div>
            <p className="max-w-md text-sm text-muted-foreground">
              Click <strong>New subject</strong> above to add your first.
            </p>
          </CardContent>
        </Card>
      )}

      {subjects.length > 0 && sorted.length === 0 && (
        <Card className="items-center py-10 text-center">
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No subjects match &ldquo;{query}&rdquo;.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Subject rows */}
      <div className="space-y-2">
        {sorted.map((subject) => {
          const usedAtCount = configCountBySubject.get(subject.id) ?? 0;
          return (
            <Card key={subject.id} className="gap-0 py-0">
              <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                    <BookOpen className="size-4" />
                  </div>
                  <div className="leading-tight">
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
                      {!subject.is_examinable && (
                        <Badge variant="muted">Non-exam</Badge>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      Used at {usedAtCount} level{usedAtCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                {usedAtCount > 0 && (
                  <DropFromAllLevelsButton
                    subjectId={subject.id}
                    subjectCode={subject.code}
                    subjectName={subject.name}
                    configCount={usedAtCount}
                  />
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// New subject button + dialog
// =====================================================================

function NewSubjectButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm<SubjectCreateInput>({
    resolver: zodResolver(SubjectCreateSchema),
    defaultValues: { code: '', name: '', is_examinable: true },
  });

  useEffect(() => {
    if (!open) form.reset({ code: '', name: '', is_examinable: true });
  }, [open, form]);

  // Tier-2 POST. The original branched on the non-ok body
  // (`body.error ?? \`Save failed (${status})\``); reconstructed from
  // ApiError so the status fallback is preserved.
  const createMutation = useMutation({
    mutationFn: (values: SubjectCreateInput) =>
      apiFetch('/api/sis/admin/subjects/catalog', jsonInit('POST', values)),
    onError: (e) => {
      if (e instanceof ApiError) {
        const bodyError = (e.body as { error?: string } | null)?.error;
        toast.error(bodyError ?? `Save failed (${e.status})`);
        return;
      }
      toast.error(e instanceof Error ? e.message : 'Save failed');
    },
  });

  async function onSubmit(values: SubjectCreateInput) {
    try {
      await createMutation.mutateAsync(values);
      toast.success(`Added ${values.code} — ${values.name}`);
      setOpen(false);
      router.refresh();
    } catch {
      // onError already surfaced the toast.
    }
  }

  const submitting = createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-3.5" />
          New subject
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            Add subject to catalogue
          </DialogTitle>
          <DialogDescription>
            New subjects flow into new AYs only after you enable them at
            specific levels via the
            <strong> Subject weights</strong> tab.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoFocus
                      placeholder="MATH, ENG, FIL…"
                      onChange={(e) =>
                        field.onChange(e.target.value.toUpperCase())
                      }
                      className="font-mono uppercase"
                    />
                  </FormControl>
                  <FormDescription>
                    Uppercase letters, digits, underscore, or hyphen. Max 32
                    characters. Permanent after creation.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Mathematics" />
                  </FormControl>
                  <FormDescription>
                    Shown on grading sheets, report cards, and dropdowns.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="is_examinable"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3 rounded-lg border border-border p-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(v) => field.onChange(v === true)}
                    />
                  </FormControl>
                  <div className="space-y-0.5 leading-tight">
                    <FormLabel className="font-medium">Examinable</FormLabel>
                    <FormDescription>
                      Counted toward the term/annual academic average. Uncheck
                      for advisory or enrichment subjects.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="size-3.5 animate-spin" />}
                Add subject
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Drop from all levels — bulk DELETE for a subject's configs
// =====================================================================

function DropFromAllLevelsButton({
  subjectId,
  subjectCode,
  subjectName,
  configCount,
}: {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  configCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Tier-2 body-less DELETE. Bespoke `Drop failed (${status})` fallback
  // reconstructed from ApiError.
  const dropMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/sis/admin/subjects/catalog/${encodeURIComponent(subjectId)}/configs`,
        jsonInit('DELETE')
      ),
    onSuccess: () => {
      toast.success(
        `Dropped ${subjectCode} from ${configCount} level${configCount === 1 ? '' : 's'}`
      );
      setOpen(false);
      router.refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const bodyError = (e.body as { error?: string } | null)?.error;
        toast.error(bodyError ?? `Drop failed (${e.status})`);
        return;
      }
      toast.error(e instanceof Error ? e.message : 'Drop failed');
    },
  });

  function submit() {
    dropMutation.mutate();
  }

  const submitting = dropMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
          Drop from all levels
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <AlertCircle className="size-4 text-destructive" />
            Drop {subjectCode} from all levels?
          </DialogTitle>
          <DialogDescription>
            Removes the (subject × level) configs for{' '}
            <strong>{subjectName}</strong> from <strong>{configCount}</strong>{' '}
            level{configCount === 1 ? '' : 's'} in the template. The subject row
            stays in the catalogue.
          </DialogDescription>
        </DialogHeader>
        <p className="text-[13px] text-muted-foreground">
          Existing AYs are unaffected — they keep their current configs until
          you remove the subject from each AY separately. New AYs created after
          this point won&apos;t include {subjectCode}.
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={submit}
            disabled={submitting}
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            Drop from all levels
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Enable (subject × level) dialog — opens when clicking a dashed matrix
// cell. Mirrors TemplateSubjectConfigEditDialog's form layout but POSTs
// instead of PATCHes, with weights pre-filled by level type.
// =====================================================================

function TemplateSubjectConfigCreateDialog({
  open,
  onOpenChange,
  subject,
  level,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  subject: SubjectRow | null;
  level: LevelRow | null;
}) {
  const router = useRouter();

  // Default weights based on level type. Matches the seeder convention
  // (lib/sis/seeder/structural.ts:129-132).
  const defaults = useMemo(() => {
    const isPrimary = level?.level_type === 'primary';
    return {
      ww: isPrimary ? '40' : '30',
      pt: isPrimary ? '40' : '50',
      qa: '20',
      ww_max: '5',
      pt_max: '5',
      qa_max: '30',
    };
  }, [level]);

  const [ww, setWw] = useState(defaults.ww);
  const [pt, setPt] = useState(defaults.pt);
  const [qa, setQa] = useState(defaults.qa);
  const [wwMax, setWwMax] = useState(defaults.ww_max);
  const [ptMax, setPtMax] = useState(defaults.pt_max);
  const [qaMax, setQaMax] = useState(defaults.qa_max);

  // Re-prime defaults when the cell context changes (different level type).
  useEffect(() => {
    if (open) {
      setWw(defaults.ww);
      setPt(defaults.pt);
      setQa(defaults.qa);
      setWwMax(defaults.ww_max);
      setPtMax(defaults.pt_max);
      setQaMax(defaults.qa_max);
    }
  }, [open, defaults]);

  const wwN = Number(ww);
  const ptN = Number(pt);
  const qaN = Number(qa);
  const sum = wwN + ptN + qaN;
  const sumOk = sum === 100;
  const profile = sumOk ? classifyProfile(wwN, ptN, qaN) : 'invalid';

  // Tier-2 POST. Bespoke `Save failed (${status})` fallback reconstructed
  // from ApiError; the success toast reads subject/level so it's built in
  // onSuccess from the closure.
  const createMutation = useMutation({
    mutationFn: (payload: TemplateSubjectConfigCreateInput) =>
      apiFetch(
        '/api/sis/admin/template/subject-configs',
        jsonInit('POST', payload)
      ),
    onSuccess: () => {
      toast.success(`Enabled ${subject?.code} at ${level?.label}`);
      onOpenChange(false);
      router.refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const bodyError = (e.body as { error?: string } | null)?.error;
        toast.error(bodyError ?? `Save failed (${e.status})`);
        return;
      }
      toast.error(e instanceof Error ? e.message : 'Save failed');
    },
  });

  function submit() {
    if (!subject || !level || !sumOk) return;
    const payload: TemplateSubjectConfigCreateInput = {
      subject_id: subject.id,
      level_id: level.id,
      ww_weight: wwN,
      pt_weight: ptN,
      qa_weight: qaN,
      ww_max_slots: Number(wwMax),
      pt_max_slots: Number(ptMax),
      qa_max: Number(qaMax),
    };
    const validated = TemplateSubjectConfigCreateSchema.safeParse(payload);
    if (!validated.success) {
      toast.error(validated.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    createMutation.mutate(payload);
  }

  const submitting = createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            Enable {subject?.code} at {level?.label}
          </DialogTitle>
          <DialogDescription>
            {subject?.name} will be added to {level?.label} grading sheets
            generated for new AYs (and any existing AY when you click{' '}
            <strong>Apply template</strong>).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <PercentField
              label="WW"
              sublabel="Written Works"
              value={ww}
              setValue={setWw}
            />
            <PercentField
              label="PT"
              sublabel="Perf. Tasks"
              value={pt}
              setValue={setPt}
            />
            <PercentField
              label="QA"
              sublabel="Quarterly"
              value={qa}
              setValue={setQa}
            />
          </div>

          <div
            className={cn(
              'flex items-center justify-between rounded-lg border px-3 py-2 text-[13px]',
              sumOk
                ? PROFILE_CLASS[profile]
                : 'border-destructive/40 bg-destructive/10'
            )}
          >
            <span
              className={cn(
                'font-medium',
                sumOk ? PROFILE_TEXT[profile].code : 'text-destructive'
              )}
            >
              {sumOk ? PROFILE_LABEL[profile] : `Sums to ${sum} — must be 100`}
            </span>
            <span
              className={cn(
                'font-mono tabular-nums',
                sumOk ? PROFILE_TEXT[profile].ratio : 'text-destructive'
              )}
            >
              {ww || 0} · {pt || 0} · {qa || 0}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <NumberField
              label="WW slots"
              value={wwMax}
              setValue={setWwMax}
              maxDigits={1}
            />
            <NumberField
              label="PT slots"
              value={ptMax}
              setValue={setPtMax}
              maxDigits={1}
            />
            <NumberField
              label="QA max"
              value={qaMax}
              setValue={setQaMax}
              maxDigits={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!sumOk || submitting}
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            Enable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
