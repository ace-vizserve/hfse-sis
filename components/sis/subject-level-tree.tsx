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
import { GripVertical, Inbox, Scale, X } from 'lucide-react';

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
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { computeLevelTree, type LevelTreeNode } from '@/lib/sis/level-tree';
import type { LevelRow } from '@/lib/sis/levels';
import {
  computeTemplateDiff,
  type TemplateConfigField,
  type TemplateSubjectConfigRow,
} from '@/lib/sis/template-diff';

// Replaces the old subject × level matrix (components/sis/subject-config-
// matrix.tsx, deleted) with a Level-rooted tree, mirroring the visual
// language of components/sis/levels-manager-client.tsx's LevelTree/
// TreeNodeRow (spine dot + connectors, @dnd-kit DndContext + closestCenter
// + PointerSensor 6px activation + DragOverlay) — but the drag semantics
// differ: here a SUBJECT CHIP is dragged onto a LEVEL NODE to attach it
// there (two different entity types, additive — not a level-onto-level
// reparent). The level tree's own shape is read-only on this page; only
// subject attachment is editable here.
//
// `computeLevelTree` is reused for the spine/branch shape, but called with
// an empty transitionRows array — the "evidenced vs fallback" distinction
// it computes from real admissions transition data has no meaning for
// subject attachment, so every branch here renders with the plain
// nearest-spine dashed connector. `levels` is expected to already be
// filtered to LEVELS OFFERED THIS AY (core + any volatile level with an
// ay_level_offerings row) by the page — attaching a subject to a level
// with no sections this year has no operational meaning.
//
// Since migration 080, one `subject_configs` row now applies to a subject
// across EVERY level it's attached to in an AY (no more per-level configs)
// — so any chip for a given subject, regardless of which level row it's
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

  const tree = React.useMemo(() => computeLevelTree(levels, []), [levels]);

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
            <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-4">
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Scale className="size-4" />
              </div>
              <div className="leading-tight">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Grade level tree · {ayCode}
                </p>
                <p className="font-serif text-[16px] font-semibold text-foreground">
                  {levels.length} level{levels.length === 1 ? '' : 's'} offered
                  — drag a subject onto one to attach it
                </p>
              </div>
            </div>

            {tree.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                No levels are offered in {ayCode} yet.
              </div>
            ) : (
              <div className="divide-y divide-border" role="tree">
                {tree.map((node, i) => (
                  <LevelDropRow
                    key={node.level.id}
                    node={node}
                    depth={0}
                    isFirstRoot={i === 0}
                    isLastRoot={i === tree.length - 1}
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
          </Card>

          <UnassignedTray
            subjects={unassignedSubjects}
            configBySubjectId={configBySubjectId}
            onOpenEdit={openEdit}
            onOpenCreate={openCreate}
          />

          <DragOverlay>
            {activeDragSubject && (
              <div className="flex items-center gap-2 rounded-lg border border-brand-indigo/40 bg-card px-3 py-2 shadow-lg">
                <GripVertical className="size-3.5 text-muted-foreground" />
                <Badge
                  variant="outline"
                  className="h-6 border-border bg-card px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
                >
                  {activeDragSubject.code}
                </Badge>
                <span className="font-serif text-sm font-semibold text-foreground">
                  {activeDragSubject.name}
                </span>
              </div>
            )}
          </DragOverlay>
        </DndContext>

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
      </TabsContent>

      <TabsContent value="structure-defaults">
        <TemplateDriftList changes={configChanges} subjects={subjects} />
      </TabsContent>
    </Tabs>
  );
}

// =====================================================================
// LevelDropRow — one level's row in the tree, spine (depth 0) or branch
// (depth 1+). Connector rendering mirrors levels-manager-client.tsx's
// TreeNodeRow exactly (dot + line for the spine root, elbow border for
// branches); the "evidenced vs fallback" solid/dashed distinction that
// component makes is dropped here since transitionRows is always [] for
// this tree (see file header). The row itself is a `useDroppable` target.
// =====================================================================

type RowSharedProps = {
  subjectsById: Map<string, Subject>;
  configBySubjectId: Map<string, Config>;
  subjectIdsByLevelId: Map<string, Set<string>>;
  onOpenEdit: (subject: Subject, config: Config) => void;
  onOpenCreate: (subject: Subject) => void;
  onDetach: (subjectId: string, levelId: string) => void;
};

function LevelDropRow({
  node,
  depth,
  isFirstRoot,
  isLastRoot,
  subjectsById,
  configBySubjectId,
  subjectIdsByLevelId,
  onOpenEdit,
  onOpenCreate,
  onDetach,
}: {
  node: LevelTreeNode;
  depth: number;
  isFirstRoot?: boolean;
  isLastRoot?: boolean;
} & RowSharedProps) {
  const isSpine = depth === 0;
  const droppable = useDroppable({
    id: `level:${node.level.id}`,
    data: { levelId: node.level.id },
  });
  const rowProps: RowSharedProps = {
    subjectsById,
    configBySubjectId,
    subjectIdsByLevelId,
    onOpenEdit,
    onOpenCreate,
    onDetach,
  };

  const attachedSubjects = Array.from(
    subjectIdsByLevelId.get(node.level.id) ?? []
  )
    .map((id) => subjectsById.get(id))
    .filter((s): s is Subject => !!s)
    .sort((a, b) => a.name.localeCompare(b.name));

  const content = (
    <div
      ref={droppable.setNodeRef}
      className={cn(
        'rounded-lg transition-colors',
        droppable.isOver &&
          'bg-brand-indigo/5 ring-2 ring-inset ring-brand-indigo/40'
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Badge
          variant="outline"
          className="h-6 shrink-0 border-border bg-card px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
        >
          {node.level.code}
        </Badge>
        <span className="font-serif text-[14px] font-semibold tracking-tight text-foreground">
          {node.level.label}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {attachedSubjects.length} subject
          {attachedSubjects.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 px-3 pb-2.5 pl-[3.25rem]">
        {attachedSubjects.length === 0 ? (
          <p className="py-1 text-[12px] text-muted-foreground/70">
            Nothing attached — drag a subject here.
          </p>
        ) : (
          attachedSubjects.map((subject) => (
            <SubjectChip
              key={subject.id}
              subject={subject}
              config={configBySubjectId.get(subject.id) ?? null}
              dragId={`chip:${subject.id}:${node.level.id}`}
              onOpen={() => {
                const cfg = configBySubjectId.get(subject.id);
                if (cfg) onOpenEdit(subject, cfg);
                else onOpenCreate(subject);
              }}
              onDetach={() => onDetach(subject.id, node.level.id)}
            />
          ))
        )}
      </div>
    </div>
  );

  if (isSpine) {
    return (
      <>
        {node.childrenBefore.map((child) => (
          <LevelDropRow
            key={child.level.id}
            node={child}
            depth={1}
            {...rowProps}
          />
        ))}
        <div className="relative flex items-stretch">
          <div className="flex w-8 shrink-0 flex-col items-center">
            <div
              className={cn(
                'w-px flex-1 bg-border',
                isFirstRoot && node.childrenBefore.length === 0 && 'invisible'
              )}
              aria-hidden
            />
            <div
              className="size-2.5 shrink-0 rounded-full bg-brand-indigo ring-4 ring-card"
              aria-hidden
            />
            <div
              className={cn(
                'w-px flex-1 bg-border',
                isLastRoot && node.childrenAfter.length === 0 && 'invisible'
              )}
              aria-hidden
            />
          </div>
          <div className="flex-1 py-1" role="treeitem">
            {content}
          </div>
        </div>
        {node.childrenAfter.map((child) => (
          <LevelDropRow
            key={child.level.id}
            node={child}
            depth={1}
            {...rowProps}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {node.childrenBefore.map((child) => (
        <LevelDropRow
          key={child.level.id}
          node={child}
          depth={depth + 1}
          {...rowProps}
        />
      ))}
      <div
        className="flex items-stretch"
        style={{ paddingLeft: `${depth * 2}rem` }}
        role="treeitem"
      >
        <div className="flex w-8 shrink-0 items-start justify-center">
          <div
            className="mt-4 h-4 w-4 rounded-bl-lg border-b-2 border-l-2 border-dashed border-muted-foreground/30"
            aria-hidden
          />
        </div>
        <div className="min-w-0 flex-1 py-1.5">{content}</div>
      </div>
      {node.childrenAfter.map((child) => (
        <LevelDropRow
          key={child.level.id}
          node={child}
          depth={depth + 1}
          {...rowProps}
        />
      ))}
    </>
  );
}

// =====================================================================
// SubjectChip — the draggable unit. Two visual states: configured
// (PROFILE_CLASS from weight-profile.tsx, same recipe the old matrix
// used) vs no-weights-yet (dashed amber outline + amber dot — visibly
// distinct from the solid-filled amber "custom" profile so the two amber
// signals don't collide). Detach ("×") only shows when a `onDetach`
// handler is supplied — tray chips omit it (nothing to detach from).
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
      className={cn(
        'group inline-flex items-stretch overflow-hidden rounded-md transition-all',
        'hover:-translate-y-0.5 hover:shadow-md',
        draggable.isDragging && 'opacity-30',
        hasConfig
          ? PROFILE_CLASS[profile!]
          : 'border-2 border-dashed border-brand-amber/50 bg-transparent hover:bg-brand-amber/5'
      )}
    >
      <button
        type="button"
        {...draggable.listeners}
        {...draggable.attributes}
        className="flex w-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/40 hover:text-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
        aria-label={`Drag ${subject.name} to attach it to another level`}
      >
        <GripVertical className="size-3" />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-col items-start gap-0.5 py-1.5 pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
        title={
          hasConfig
            ? `${subject.name} — click to edit weights`
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
      </button>
      {onDetach && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDetach();
          }}
          className="flex w-6 shrink-0 items-center justify-center text-muted-foreground/40 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 group-hover:opacity-100"
          aria-label={`Detach ${subject.name} from this level`}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

// =====================================================================
// Unassigned tray — subjects with zero `subject_level_offerings` rows for
// this AY. Mirrors the visual language of levels-manager-client.tsx's
// SmartSyncPanel (amber gradient-tile header for "needs attention"), and
// the design system's quiet-clean-state convention for the empty case
// (plain caption, no big tile) matching TemplateDriftList's own empty
// state below.
// =====================================================================

function UnassignedTray({
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
      <Card className="items-center py-8 text-center">
        <div className="flex flex-col items-center gap-2 px-6 py-2">
          <p className="text-sm text-muted-foreground">
            Every subject is attached to at least one level.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-3 border-b border-border bg-brand-amber/5 px-5 py-4">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber">
          <Inbox className="size-4" />
        </div>
        <div className="leading-tight">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Unassigned
          </p>
          <p className="font-serif text-[16px] font-semibold text-foreground">
            {subjects.length} subject{subjects.length === 1 ? '' : 's'} not
            attached to any level
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 p-4">
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
      <p className="border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
        Drag a subject onto a level above to attach it there.
      </p>
    </Card>
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
