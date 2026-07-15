'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Scale, X } from 'lucide-react';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  SubjectConfigCreateDialog,
  SubjectConfigEditDialog,
  type SubjectConfigDraft,
} from '@/components/sis/subject-config-edit-dialog';
import {
  classifyProfile,
  PROFILE_CLASS,
  PROFILE_TEXT,
} from '@/components/sis/weight-profile';
import { SubjectMonitoringTable } from '@/components/sis/subject-monitoring-table';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { computeLevelTree, flattenLevelTree } from '@/lib/sis/level-tree';
import type { LevelRow } from '@/lib/sis/levels';
import {
  computeTemplateDiff,
  type TemplateConfigField,
  type TemplateSubjectConfigRow,
} from '@/lib/sis/template-diff';

// Replaces the old subject × level matrix (components/sis/subject-config-
// matrix.tsx, deleted) with a Level-rooted tree — but rendered as a flat,
// flush list of level groups rather than a literal org-chart (dot-and-line
// spine + dashed elbow connectors). The level tree's own SHAPE is still
// computed via computeLevelTree/flattenLevelTree (so display order matches
// the real spine+branch structure), but it's read-only on this page — only
// subject attachment is editable here, so there's no reader-facing reason
// to draw the family-tree geometry that components/sis/levels-manager-
// client.tsx's tree needs (that page's connectors carry real information:
// evidenced-vs-fallback attachment; this page's connectors carried none).
//
// Drag semantics: a SUBJECT CHIP is dragged onto a LEVEL GROUP to attach it
// there (two different entity types, additive — not a level reparent).
// `useDraggable` lives on the whole chip (not a separate grip sub-element)
// — a plain click still resolves as a click because @dnd-kit's PointerSensor
// activation constraint (6px) only starts a drag once the pointer has
// actually moved past that threshold.
//
// Since migration 080, one `subject_configs` row now applies to a subject
// across EVERY level it's attached to in an AY (no more per-level configs)
// — so any chip for a given subject, regardless of which level it's
// rendered under, opens the SAME weights dialog.

type Subject = {
  id: string;
  code: string;
  name: string;
  is_examinable: boolean;
};
type Config = {
  id: string;
  academic_year_id: string;
  subject_id: string;
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number;
};
type Offering = { subject_id: string; level_id: string };
type ReportMapRow = { subject_id: string; report_subject_id: string };

export function SubjectLevelTree({
  subjects,
  levels,
  configs,
  offerings,
  reportMap,
  templateConfigs,
  ayCode,
  ayId,
}: {
  subjects: Subject[];
  levels: LevelRow[];
  configs: Config[];
  offerings: Offering[];
  reportMap: ReportMapRow[];
  templateConfigs: TemplateSubjectConfigRow[];
  ayCode: string;
  ayId: string;
}) {
  const router = useRouter();
  const [activeDragSubjectId, setActiveDragSubjectId] = React.useState<
    string | null
  >(null);
  const [editDraft, setEditDraft] = React.useState<SubjectConfigDraft | null>(
    null
  );
  const [editOpen, setEditOpen] = React.useState(false);
  const [createSubject, setCreateSubject] = React.useState<Subject | null>(
    null
  );
  const [createOpen, setCreateOpen] = React.useState(false);

  const subjectsById = React.useMemo(
    () => new Map(subjects.map((s) => [s.id, s])),
    [subjects]
  );
  const configBySubjectId = React.useMemo(
    () => new Map(configs.map((c) => [c.subject_id, c])),
    [configs]
  );
  const reportSubjectIdBySubjectId = React.useMemo(
    () => new Map(reportMap.map((r) => [r.subject_id, r.report_subject_id])),
    [reportMap]
  );
  const levelIdsBySubjectId = React.useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const o of offerings) {
      const set = m.get(o.subject_id) ?? new Set<string>();
      set.add(o.level_id);
      m.set(o.subject_id, set);
    }
    return m;
  }, [offerings]);
  const subjectIdsByLevelId = React.useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const o of offerings) {
      const set = m.get(o.level_id) ?? new Set<string>();
      set.add(o.subject_id);
      m.set(o.level_id, set);
    }
    return m;
  }, [offerings]);
  const unassignedSubjects = React.useMemo(
    () => subjects.filter((s) => !levelIdsBySubjectId.get(s.id)?.size),
    [subjects, levelIdsBySubjectId]
  );

  // Structure Defaults tab — value drift only (weights/slots for subjects
  // that exist in both places), the complement of the page-level gap
  // banner (which flags subjects missing entirely). Same diff engine
  // Task 1/3 use for the template's Propagate-to-AYs preview; sections
  // params are irrelevant here so [] / [] is passed.
  const configChanges = React.useMemo(
    () => computeTemplateDiff(templateConfigs, configs, [], []).configChanges,
    [templateConfigs, configs]
  );

  // Flattened to a plain ordered list — same spine+branch ORDER
  // computeLevelTree produces, minus the recursive depth/connector
  // structure this page has no use for (see file header).
  const flatLevels = React.useMemo(
    () => flattenLevelTree(computeLevelTree(levels, [])).map((n) => n.level),
    [levels]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const attachMutation = useMutation({
    mutationFn: (vars: { subjectId: string; levelId: string }) =>
      apiFetch(
        '/api/sis/admin/subjects/level-offerings',
        jsonInit('PUT', {
          subject_id: vars.subjectId,
          level_id: vars.levelId,
          academic_year_id: ayId,
          offered: true,
        })
      ),
    onSuccess: (_data, vars) => {
      const subject = subjectsById.get(vars.subjectId);
      const level = levels.find((l) => l.id === vars.levelId);
      toast.success(
        `Attached ${subject?.code ?? 'subject'} to ${level?.label ?? 'level'}`
      );
      router.refresh();
    },
    onError: (e) => {
      toast.error(
        e instanceof Error ? e.message : 'Could not attach this subject'
      );
    },
  });

  const detachMutation = useMutation({
    mutationFn: (vars: { subjectId: string; levelId: string }) =>
      apiFetch(
        '/api/sis/admin/subjects/level-offerings',
        jsonInit('PUT', {
          subject_id: vars.subjectId,
          level_id: vars.levelId,
          academic_year_id: ayId,
          offered: false,
        })
      ),
    onSuccess: (_data, vars) => {
      const subject = subjectsById.get(vars.subjectId);
      toast.success(`Detached ${subject?.code ?? 'subject'}`);
      router.refresh();
    },
    onError: (e) => {
      toast.error(
        e instanceof Error ? e.message : 'Could not detach this subject'
      );
    },
  });

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragSubjectId(null);
    const { active, over } = event;
    if (!over) return;
    const subjectId = active.data.current?.subjectId as string | undefined;
    const levelId = over.data.current?.levelId as string | undefined;
    if (!subjectId || !levelId) return;
    if (levelIdsBySubjectId.get(subjectId)?.has(levelId)) return; // already attached
    attachMutation.mutate({ subjectId, levelId });
  }

  function openEdit(subject: Subject, config: Config) {
    setEditDraft({
      configId: config.id,
      subjectId: subject.id,
      subjectCode: subject.code,
      subjectName: subject.name,
      ayCode,
      ww_weight: Math.round(config.ww_weight * 100),
      pt_weight: Math.round(config.pt_weight * 100),
      qa_weight: Math.round(config.qa_weight * 100),
      ww_max_slots: config.ww_max_slots,
      pt_max_slots: config.pt_max_slots,
      qa_max: config.qa_max,
      reportSubjectId: reportSubjectIdBySubjectId.get(subject.id) ?? subject.id,
    });
    setEditOpen(true);
  }

  function openCreate(subject: Subject) {
    setCreateSubject(subject);
    setCreateOpen(true);
  }

  function detach(subjectId: string, levelId: string) {
    detachMutation.mutate({ subjectId, levelId });
  }

  const activeDragSubject = activeDragSubjectId
    ? (subjectsById.get(activeDragSubjectId) ?? null)
    : null;

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
        <TabsTrigger value="all-subjects">All subjects</TabsTrigger>
      </TabsList>

      <TabsContent value="this-year" className="space-y-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) =>
            setActiveDragSubjectId(
              (e.active.data.current?.subjectId as string) ?? null
            )
          }
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDragSubjectId(null)}
        >
          <Card className="gap-0 overflow-hidden py-0">
            <div className="flex items-center gap-3 px-5 pb-4 pt-5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Scale className="size-4" />
              </div>
              <div className="leading-tight">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {ayCode} · {levels.length} level
                  {levels.length === 1 ? '' : 's'} offered
                </p>
                <p className="font-serif text-[16px] font-semibold text-foreground">
                  Drag a subject onto a level to attach it
                </p>
              </div>
            </div>

            {flatLevels.length === 0 ? (
              <div className="px-5 pb-10 text-center text-sm text-muted-foreground">
                No levels are offered in {ayCode} yet.
              </div>
            ) : (
              <div className="px-5 pb-1" role="list">
                {flatLevels.map((level, i) => (
                  <LevelGroup
                    key={level.id}
                    level={level}
                    isFirst={i === 0}
                    subjectsById={subjectsById}
                    configBySubjectId={configBySubjectId}
                    subjectIdsByLevelId={subjectIdsByLevelId}
                    onOpenEdit={openEdit}
                    onOpenCreate={openCreate}
                    onDetach={detach}
                  />
                ))}
              </div>
            )}

            <UnassignedBand
              subjects={unassignedSubjects}
              configBySubjectId={configBySubjectId}
              onOpenEdit={openEdit}
              onOpenCreate={openCreate}
            />
          </Card>

          <DragOverlay>
            {activeDragSubject && (
              <div className="inline-flex items-center gap-2 rounded-md bg-card px-3 py-1.5 shadow-lg ring-1 ring-brand-indigo/30">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {activeDragSubject.code}
                </span>
                <span className="font-serif text-[13px] font-semibold text-foreground">
                  {activeDragSubject.name}
                </span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </TabsContent>

      <TabsContent value="structure-defaults">
        <TemplateDriftList changes={configChanges} subjects={subjects} />
      </TabsContent>

      <TabsContent value="all-subjects">
        <SubjectMonitoringTable
          subjects={subjects}
          levels={levels}
          configBySubjectId={configBySubjectId}
          levelIdsBySubjectId={levelIdsBySubjectId}
          reportSubjectIdBySubjectId={reportSubjectIdBySubjectId}
          onOpenEdit={openEdit}
          onOpenCreate={openCreate}
        />
      </TabsContent>

      {/* Mounted outside any TabsContent — Radix unmounts inactive tab
          content, but these two dialogs are opened from openEdit/openCreate
          handlers reachable from BOTH the "This year" tree and the "All
          subjects" table, so they must stay mounted regardless of which
          tab is active. */}
      <SubjectConfigEditDialog
        draft={editDraft}
        open={editOpen}
        onOpenChange={setEditOpen}
        subjects={subjects}
      />
      <SubjectConfigCreateDialog
        subject={createSubject}
        ayId={ayId}
        ayCode={ayCode}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </Tabs>
  );
}

// =====================================================================
// LevelGroup — one level's row: a slim header (a small colored dot marks
// core/spine levels vs branch levels — indigo vs muted, replacing the old
// dot-and-line spine + dashed elbow connector geometry, which on this page
// carried no information beyond "this level is core" that the dot alone
// doesn't already say) followed directly by its attached-subject chips,
// flush with no enclosing box. Groups are separated by a single top
// hairline rather than a divider after every row, so the page reads as one
// continuous surface. The row itself is a `useDroppable` target.
// =====================================================================

type SharedProps = {
  subjectsById: Map<string, Subject>;
  configBySubjectId: Map<string, Config>;
  subjectIdsByLevelId: Map<string, Set<string>>;
  onOpenEdit: (subject: Subject, config: Config) => void;
  onOpenCreate: (subject: Subject) => void;
  onDetach: (subjectId: string, levelId: string) => void;
};

function LevelGroup({
  level,
  isFirst,
  subjectsById,
  configBySubjectId,
  subjectIdsByLevelId,
  onOpenEdit,
  onOpenCreate,
  onDetach,
}: { level: LevelRow; isFirst: boolean } & SharedProps) {
  const droppable = useDroppable({
    id: `level:${level.id}`,
    data: { levelId: level.id },
  });

  const attachedSubjects = Array.from(subjectIdsByLevelId.get(level.id) ?? [])
    .map((id) => subjectsById.get(id))
    .filter((s): s is Subject => !!s)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div
      ref={droppable.setNodeRef}
      className={cn(
        'rounded-lg py-3.5 transition-colors',
        !isFirst && 'border-t border-border',
        droppable.isOver &&
          'bg-brand-indigo/5 ring-2 ring-inset ring-brand-indigo/40'
      )}
      role="listitem"
    >
      <div className="flex flex-wrap items-center gap-2 px-2">
        <span
          className={cn(
            'size-[5px] shrink-0 rounded-full',
            level.isCore ? 'bg-brand-indigo' : 'bg-muted-foreground/40'
          )}
          aria-hidden
        />
        <span
          className={cn(
            'font-mono text-[11px] font-bold tracking-[0.1em]',
            level.isCore ? 'text-brand-indigo' : 'text-muted-foreground'
          )}
        >
          {level.code}
        </span>
        <span className="font-serif text-[15px] font-semibold text-foreground">
          {level.label}
        </span>
        <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
          {attachedSubjects.length} subject
          {attachedSubjects.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 px-2 pl-[15px] pt-2.5">
        {attachedSubjects.length === 0 ? (
          <p className="py-0.5 text-[12px] text-muted-foreground/70">
            Nothing attached — drag a subject here.
          </p>
        ) : (
          attachedSubjects.map((subject) => (
            <SubjectChip
              key={subject.id}
              subject={subject}
              config={configBySubjectId.get(subject.id) ?? null}
              dragId={`chip:${subject.id}:${level.id}`}
              onOpen={() => {
                const cfg = configBySubjectId.get(subject.id);
                if (cfg) onOpenEdit(subject, cfg);
                else onOpenCreate(subject);
              }}
              onDetach={() => onDetach(subject.id, level.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// =====================================================================
// SubjectChip — the draggable + clickable unit, now a single flat pill
// (no more grip / label / detach welded into three separately-bordered
// segments). `useDraggable`'s listeners live on the whole chip; a plain
// click still resolves as a click because @dnd-kit's PointerSensor only
// starts a drag once the pointer has moved past its 6px activation
// distance (the same sensor config the parent DndContext already uses),
// so no separate hit-target is needed to disambiguate the two gestures.
// Two visual states: configured (PROFILE_CLASS from weight-profile.tsx —
// shared with the Structure Defaults editor so the two surfaces keep
// identical chip semantics) vs no-weights-yet (dashed amber outline).
// Detach ("×") only renders when `onDetach` is supplied — tray chips omit
// it (nothing to detach from) — and stops the pointerdown/click from
// reaching the chip's own drag/open handlers.
// =====================================================================

function SubjectChip({
  subject,
  config,
  dragId,
  onOpen,
  onDetach,
}: {
  subject: Subject;
  config: Config | null;
  dragId: string;
  onOpen: () => void;
  onDetach?: () => void;
}) {
  const draggable = useDraggable({
    id: dragId,
    data: { subjectId: subject.id },
  });
  const hasConfig = !!config;
  const profile = hasConfig
    ? classifyProfile(
        Math.round(config!.ww_weight * 100),
        Math.round(config!.pt_weight * 100),
        Math.round(config!.qa_weight * 100)
      )
    : null;

  return (
    <div
      ref={draggable.setNodeRef}
      {...draggable.listeners}
      {...draggable.attributes}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group relative inline-flex cursor-grab touch-none items-center gap-1.5 rounded-md py-1.5 pl-2.5 pr-2.5 transition-all',
        'hover:-translate-y-0.5 hover:shadow-sm active:cursor-grabbing',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40',
        draggable.isDragging && 'opacity-30',
        hasConfig
          ? PROFILE_CLASS[profile!]
          : 'border border-dashed border-brand-amber/50 bg-transparent hover:bg-brand-amber/5'
      )}
      title={
        hasConfig
          ? `${subject.name} — drag to attach elsewhere, click to edit weights`
          : `${subject.name} — no weights set yet, click to configure`
      }
      aria-label={
        hasConfig
          ? `${subject.name} — drag to attach elsewhere, click to edit weights`
          : `${subject.name} — no weights set yet, click to configure`
      }
    >
      <span
        className={cn(
          'inline-flex items-center gap-1.5 font-serif text-[12px] font-semibold leading-tight tracking-tight',
          hasConfig ? PROFILE_TEXT[profile!].code : 'text-brand-amber'
        )}
      >
        {!hasConfig && (
          <span
            className="size-1.5 shrink-0 rounded-full bg-brand-amber"
            aria-hidden
          />
        )}
        {subject.code}
      </span>
      <span
        className={cn(
          'font-mono text-[10px] tabular-nums',
          hasConfig ? PROFILE_TEXT[profile!].ratio : 'text-brand-amber/80'
        )}
      >
        {hasConfig
          ? `${Math.round(config!.ww_weight * 100)}·${Math.round(config!.pt_weight * 100)}·${Math.round(config!.qa_weight * 100)}`
          : 'No weights set'}
      </span>
      {onDetach && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDetach();
          }}
          className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 group-hover:opacity-100"
          aria-label={`Detach ${subject.name} from this level`}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

// =====================================================================
// Unassigned band — subjects with zero `subject_level_offerings` rows for
// this AY. Lives inside the SAME Card as the level groups (a tinted band
// at the bottom) rather than a second separately-bordered Card with its
// own gradient icon-tile header — the two "boxes" that used to stack here
// read as one continuous surface now.
// =====================================================================

function UnassignedBand({
  subjects,
  configBySubjectId,
  onOpenEdit,
  onOpenCreate,
}: {
  subjects: Subject[];
  configBySubjectId: Map<string, Config>;
  onOpenEdit: (subject: Subject, config: Config) => void;
  onOpenCreate: (subject: Subject) => void;
}) {
  if (subjects.length === 0) {
    return (
      <p className="border-t border-border px-5 py-3 text-center text-[12px] text-muted-foreground">
        Every subject is attached to at least one level.
      </p>
    );
  }

  return (
    <div className="border-t border-border bg-brand-amber/5 px-5 py-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-brand-amber">
          Unassigned
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {subjects.length} subject{subjects.length === 1 ? '' : 's'} not
          attached to any level — drag one onto a level above
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {subjects
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((subject) => (
            <SubjectChip
              key={subject.id}
              subject={subject}
              config={configBySubjectId.get(subject.id) ?? null}
              dragId={`chip:${subject.id}:tray`}
              onOpen={() => {
                const cfg = configBySubjectId.get(subject.id);
                if (cfg) onOpenEdit(subject, cfg);
                else onOpenCreate(subject);
              }}
            />
          ))}
      </div>
    </div>
  );
}

// =====================================================================
// Structure Defaults tab — value-drift list. Answers "for subjects that
// exist in both this AY and the template, do their weights/slots differ?"
// (the page-level gap banner answers the complementary "is a subject
// missing entirely?" question). Carried over unchanged from the old
// subject-config-matrix.tsx — still a pure subject-scoped comparison, no
// level dimension.
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
}: {
  changes: Array<{
    subjectId: string;
    field: TemplateConfigField;
    from: number;
    to: number;
  }>;
  subjects: Subject[];
}) {
  const subjectById = React.useMemo(
    () => new Map(subjects.map((s) => [s.id, s])),
    [subjects]
  );

  if (changes.length === 0) {
    return (
      <Card className="items-center py-10 text-center">
        <div className="flex flex-col items-center gap-2 px-6 py-2">
          <p className="text-sm text-muted-foreground">
            Every subject configured in this AY matches Structure Defaults —
            nothing has drifted.
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
          return (
            <div
              key={`${c.subjectId}-${c.field}-${i}`}
              className="flex items-center gap-2 text-xs"
            >
              <Badge variant="warning">~ DRIFT</Badge>
              <span className="text-foreground">
                {subject?.code ?? c.subjectId} · {TEMPLATE_FIELD_LABEL[c.field]}
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
