'use client';

import { type ColumnDef } from '@tanstack/react-table';
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  ListChecks,
  Lock,
  Pencil,
  Plus,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  AttachToSectionModal,
  type AttachSection,
} from '@/components/sis/attach-to-section-modal';
import { NewSubjectForm } from '@/components/sis/new-subject-form';
import { SectionTermSheetsDialog } from '@/components/sis/section-term-sheets-dialog';
import { SubjectCatalogMenu } from '@/components/sis/unused-subject-actions';
import type { SubjectSetupSummary } from '@/lib/sis/subjects/setup-summary';
import {
  SubjectConfigForm,
  type SubjectConfigFormDraft,
  type SubjectConfigFormSubject,
} from '@/components/sis/subject-config-form';
import {
  classifyProfile,
  ProfileKeySwatch,
  ProfileWeightBar,
  type WeightProfile,
} from '@/components/sis/weight-profile';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { FacetConfig } from '@/components/ui/data-table/types';
import { HoverHint } from '@/components/ui/hover-hint';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatLevelSpan } from '@/lib/sis/subjects/level-span';
import type { CatalogSubjectRow } from '@/lib/sis/subjects/queries';
import { cn } from '@/lib/utils';

// The whole Subject Setup page, in one card — rebuilt after the prior
// "catalog + tune + per-section checklist" design was rejected live as
// overengineered ("we have a list of subjects... we select a catalog to
// be attached to a section... a confirmation modal... creates a grading
// sheet"). One table: checkbox, subject, weights. Check a few rows, a bar
// appears, click it, pick section(s) in a confirm modal (creates the
// grading sheets), done.
//
// The table is the app's DataTable, so it carries the shared search box and
// facet filters (Grading / Weights / Classes). The three facets read hidden
// columns — they exist only to be filtered on.
//
// Dropped on purpose, all per explicit live feedback: the per-row "Needs
// attention" badge (a subject with no weights just reads "Not set" and
// can't be checked — click "Set weights" to fix it), the Global/Standard
// track-flagging step and its "Unflagged" badge, the Advanced-view escape
// hatch, and every recommended-tag/bundle computation. Attaching is fully
// manual — no track auto-suggestion anywhere on this page.

function draftFromRow(
  row: CatalogSubjectRow,
  ayCode: string
): SubjectConfigFormDraft {
  const cfg = row.config!;
  return {
    configId: cfg.id,
    id: row.id,
    code: row.code,
    name: row.name,
    is_examinable: row.is_examinable,
    grading_method: row.grading_method,
    ayCode,
    ww_weight: Math.round(cfg.ww_weight * 100),
    pt_weight: Math.round(cfg.pt_weight * 100),
    qa_weight: Math.round(cfg.qa_weight * 100),
    ww_max_slots: cfg.ww_max_slots,
    pt_max_slots: cfg.pt_max_slots,
    qa_max: cfg.qa_max,
    reportSubjectId: row.reportSubjectId,
    description: cfg.description,
  };
}

type UsedBySectionChip = {
  name: string;
  sheetId: string;
  termNumber: number;
  isLocked: boolean;
  isCurrentTerm: boolean;
};

type UsedByImpact = {
  totalSections: number;
  levelCodes: string[];
  sectionsByLevel: Array<{
    levelCode: string;
    sections: UsedBySectionChip[];
  }>;
};

// Facet vocabularies. The same strings feed the hidden columns' accessors and
// the facets' option lists, so a rename cannot desync them.
const GRADING_NUMBER = 'Number grade';
const GRADING_LETTER = 'Letter grade';
const WEIGHTS_SET = 'Set';
const WEIGHTS_NOT_SET = 'Not set';
const WEIGHTS_NO_SHEET = 'No sheet';
const CLASSES_ATTACHED = 'Attached';
const CLASSES_NOT_ATTACHED = 'Not attached';

const FACETS: FacetConfig[] = [
  {
    columnId: 'grading',
    label: 'Grading',
    valueOptions: [GRADING_NUMBER, GRADING_LETTER],
  },
  {
    columnId: 'weights',
    label: 'Weights',
    valueOptions: [WEIGHTS_SET, WEIGHTS_NOT_SET, WEIGHTS_NO_SHEET],
  },
  {
    columnId: 'classes',
    label: 'Classes',
    valueOptions: [CLASSES_ATTACHED, CLASSES_NOT_ATTACHED],
  },
];

/**
 * Which classes already teach this subject.
 *
 * The page's job is "check the ones you want, then attach them to a section",
 * so the row should say what is already attached before you attach more. It
 * also answers the question the form could not: one config covers the whole
 * subject for the year, so editing English from the PRIMARY tab changes S1–S4
 * classes this screen never lists.
 *
 * Collapsed by default. Maths, Science and English are each in all 21 classes
 * — listing those names inline made every such row four lines deep, and the
 * table is scanned far more often than it is interrogated. The two facts worth
 * scanning (how far it reaches, how many classes) stay on the collapsed row;
 * the names cost a click — for a one-level subject too, because the expanded
 * chips are what open a grading sheet.
 */
function UsedByCell({
  impact,
  isOpen,
  subjectName,
  onToggle,
}: {
  impact: UsedByImpact | undefined;
  isOpen: boolean;
  subjectName: string;
  onToggle: () => void;
}) {
  if (!impact || impact.totalSections === 0) {
    return (
      <span className="text-[12px] italic text-muted-foreground">
        Not attached to any class yet
      </span>
    );
  }

  const count = `${impact.totalSections} ${impact.totalSections === 1 ? 'class' : 'classes'}`;
  // Only the levels that actually take it, in level order. An earlier
  // mockup drew every level of the tab with the taken ones filled, and the
  // filled/empty meaning had to be explained — naming the levels needs no key.
  const levels = impact.sectionsByLevel.map((g) => g.levelCode);

  return (
    <HoverHint
      hint={`${subjectName} — ${formatLevelSpan(impact.levelCodes)}, ${count}. Show the classes.`}
      focusable={false}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="-ml-2 inline-flex items-center gap-2 rounded-md border border-transparent px-2 py-1 text-left transition-colors hover:border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="flex flex-col gap-1 leading-tight">
          <span className="flex flex-wrap gap-1">
            {levels.map((code) => (
              <span
                key={code}
                className="inline-flex min-w-7 justify-center rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-accent-foreground"
              >
                {code}
              </span>
            ))}
          </span>
          <span className="text-[12px] text-muted-foreground">{count}</span>
        </span>
        <ChevronDown
          className={cn(
            'size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
            isOpen && 'rotate-180'
          )}
        />
      </button>
    </HoverHint>
  );
}

function subjectIdentity(row: CatalogSubjectRow): SubjectConfigFormSubject {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    is_examinable: row.is_examinable,
    grading_method: row.grading_method,
  };
}

export function SubjectCatalogCard({
  catalog,
  levelLabel,
  ayCode,
  ayId,
  sections,
  defaultSectionLevelType,
  sheetImpactByConfigId,
  deletableSubjects = {},
}: {
  catalog: CatalogSubjectRow[];
  /** Subjects no class uses, each with what a Delete takes with it — the
   * only ones offered Delete. */
  deletableSubjects?: Record<string, SubjectSetupSummary>;
  levelLabel: string;
  ayCode: string;
  ayId: string;
  /** Unlocked sheets + distinct classes a save would touch, keyed by
   * `subject_configs.id` (see lib/sis/subjects/sheet-impact.ts). Feeds the
   * edit form's scope alert. A config absent from the map has none. */
  sheetImpactByConfigId?: Record<
    string,
    {
      unlockedSheets: number;
      unlockedSections: number;
      totalSections: number;
      levelCodes: string[];
      sectionsByLevel: Array<{
        levelCode: string;
        sections: UsedBySectionChip[];
      }>;
    }
  >;
  /** Every section, BOTH level types — the "Attach to section" modal picks
   * its own level internally, independent of this page's catalog tab. */
  sections: AttachSection[];
  /** Which level the modal's own toggle starts on — this page's currently
   * active catalog tab. */
  defaultSectionLevelType: 'primary' | 'secondary';
}) {
  // What the "Attach to section" modal was opened with. Captured when the bulk
  // action fires, because the table owns the live selection.
  const [attachSubjects, setAttachSubjects] = useState<
    Array<{ subjectConfigId: string; code: string; name: string }>
  >([]);
  // Bumped after a successful attach so the table drops its selection.
  const [selectionResetSignal, setSelectionResetSignal] = useState(0);
  const [editSubject, setEditSubject] = useState<CatalogSubjectRow | null>(
    null
  );
  const [addOpen, setAddOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // The class chip that was clicked. Carries ONE of that class's sheets for
  // this subject; the dialog finds its sibling terms, which is the whole point
  // — a chip has only ever pointed at one of the four.
  const [sheetsFor, setSheetsFor] = useState<{
    sheetId: string;
    sectionName: string;
  } | null>(null);

  function toggleExpanded(subjectId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) next.delete(subjectId);
      else next.add(subjectId);
      return next;
    });
  }

  const subjectOptions = catalog.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
  }));

  const attachedCount = (c: CatalogSubjectRow) =>
    c.config ? (sheetImpactByConfigId?.[c.config.id]?.totalSections ?? 0) : 0;

  // The summary strip's counts. Every one is a state the table's own rows
  // show, so the strip is a tally of the column below it, not a new metric.
  const profileOf = (c: CatalogSubjectRow): WeightProfile | null =>
    c.grading_method === 'no_sheet' || !c.config
      ? null
      : classifyProfile(
          c.code,
          Math.round(c.config.ww_weight * 100),
          Math.round(c.config.pt_weight * 100),
          Math.round(c.config.qa_weight * 100)
        );
  const summary = {
    attached: catalog.filter((c) => attachedCount(c) > 0).length,
    notSet: catalog.filter((c) => !c.config && c.grading_method !== 'no_sheet')
      .length,
    custom: catalog.filter((c) => profileOf(c) === 'custom').length,
    invalid: catalog.filter((c) => profileOf(c) === 'invalid').length,
    noSheet: catalog.filter((c) => c.grading_method === 'no_sheet').length,
  };

  const columns = useMemo<ColumnDef<CatalogSubjectRow>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => {
          const selectable = table
            .getRowModel()
            .rows.filter((r) => r.getCanSelect());
          const selectedCount = selectable.filter((r) =>
            r.getIsSelected()
          ).length;
          const all =
            selectable.length > 0 && selectedCount === selectable.length;
          const some = selectedCount > 0 && !all;
          return (
            <Checkbox
              checked={all ? true : some ? 'indeterminate' : false}
              onCheckedChange={(v) => {
                for (const r of selectable) r.toggleSelected(!!v);
              }}
              disabled={selectable.length === 0}
              aria-label="Select all attachable subjects"
            />
          );
        },
        meta: { label: 'Select' },
        cell: ({ row }) => {
          const subject = row.original;
          const attachable = subject.hasConfig && !!subject.config;
          const checked = row.getIsSelected();
          // The hint exists only when the Checkbox is disabled, and a
          // disabled checkbox is a disabled <button> — it fires no hover and
          // takes no focus. `wrap` puts the trigger on a span around it.
          return (
            <HoverHint
              hint={
                attachable
                  ? undefined
                  : 'Not attachable yet — set its weights first'
              }
              wrap
            >
              <Checkbox
                checked={checked}
                disabled={!attachable}
                onCheckedChange={(v) => row.toggleSelected(v === true)}
                aria-label={`${subject.name} — ${checked ? 'selected' : 'not selected'}`}
              />
            </HoverHint>
          );
        },
        enableSorting: false,
        enableHiding: false,
      },
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => (
          <SortableHeader column={column}>Subject</SortableHeader>
        ),
        meta: { label: 'Subject' },
        cell: ({ row }) => (
          // The name is the label; the code is its ID, read like a student
          // number under a name.
          <div className="flex flex-col gap-0.5 leading-tight">
            <span className="font-serif text-[14px] font-semibold text-foreground">
              {row.original.name}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {row.original.code}
            </span>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: 'usedBy',
        header: 'Used by',
        cell: ({ row }) => {
          const subject = row.original;
          return (
            <UsedByCell
              impact={
                subject.config
                  ? sheetImpactByConfigId?.[subject.config.id]
                  : undefined
              }
              isOpen={expandedIds.has(subject.id)}
              subjectName={subject.name}
              onToggle={() => toggleExpanded(subject.id)}
            />
          );
        },
      },
      {
        id: 'weightsBar',
        header: 'Weights (WW · PT · QA)',
        cell: ({ row }) => (
          <WeightsCell
            subject={row.original}
            onFix={() => setEditSubject(row.original)}
          />
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { label: 'Actions', excludeFromExport: true },
        cell: ({ row }) => (
          <span className="flex items-center justify-end">
            {/* ⋯ menu: Edit, and Delete for a subject no class uses
                (unused-subject-actions.tsx). */}
            <SubjectCatalogMenu
              subject={row.original}
              deleteSetup={deletableSubjects[row.original.id]}
              onEdit={() => setEditSubject(row.original)}
            />
          </span>
        ),
        enableSorting: false,
        enableHiding: false,
      },
      // Filter-only columns: hidden (see initialColumnVisibility), read by the
      // three facets above.
      {
        id: 'grading',
        accessorFn: (c) => (c.is_examinable ? GRADING_NUMBER : GRADING_LETTER),
        header: 'Grading',
        enableHiding: false,
      },
      {
        id: 'weights',
        accessorFn: (c) =>
          c.grading_method === 'no_sheet'
            ? WEIGHTS_NO_SHEET
            : c.config
              ? WEIGHTS_SET
              : WEIGHTS_NOT_SET,
        header: 'Weights',
        enableHiding: false,
      },
      {
        id: 'classes',
        accessorFn: (c) =>
          attachedCount(c) > 0 ? CLASSES_ATTACHED : CLASSES_NOT_ATTACHED,
        header: 'Classes',
        enableHiding: false,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expandedIds, sheetImpactByConfigId, deletableSubjects]
  );

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center gap-3 px-5 pb-4 pt-5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <ListChecks className="size-4" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Subject catalog
            </p>
            <p className="truncate font-serif text-[16px] font-semibold text-foreground">
              {catalog.length} subject{catalog.length === 1 ? '' : 's'} ·{' '}
              {levelLabel}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-3.5" />
            Add subject
          </Button>
        </div>

        {catalog.length > 0 && (
          // §8 group-container meta strip: the tallies on the left, and on
          // the right the key to the weight bars' colours — without it the
          // mint / amber / red had nothing on the page saying what they mean.
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border bg-muted/30 px-5 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12.5px] text-muted-foreground">
              <SummaryCount value={summary.attached} label="attached" />
              {summary.notSet > 0 && (
                <SummaryCount value={summary.notSet} label="not set" warn />
              )}
              {summary.custom > 0 && (
                <SummaryCount
                  value={summary.custom}
                  label="custom weights"
                  warn
                />
              )}
              {summary.invalid > 0 && (
                <SummaryCount
                  value={summary.invalid}
                  label="don't add to 100"
                  danger
                />
              )}
              {summary.noSheet > 0 && (
                <SummaryCount value={summary.noSheet} label="no sheet" />
              )}
            </div>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12px] text-muted-foreground">
              <ProfileKeySwatch profile="correct" />
              <ProfileKeySwatch profile="custom" />
              <ProfileKeySwatch profile="invalid" />
            </div>
          </div>
        )}

        {catalog.length === 0 ? (
          <div className="border-t border-border px-5 py-10 text-center text-sm text-muted-foreground">
            Nothing in the catalog for this level yet. Click{' '}
            <strong>Add subject</strong> above to add the first one.
          </div>
        ) : (
          <div className="border-t border-border p-5">
            <DataTable<CatalogSubjectRow>
              data={catalog}
              columns={columns}
              getRowId={(c) => c.id}
              searchKeys={['name', 'code']}
              searchPlaceholder="Search subject or code…"
              facets={FACETS}
              initialColumnVisibility={{
                grading: false,
                weights: false,
                classes: false,
              }}
              initialSort={[{ id: 'name', desc: false }]}
              // The whole catalog for a level fits on one page; it was never
              // paginated before.
              pageSize={100}
              hidePagination
              selection={{
                enabled: true,
                // Only a subject with weights can be attached to a section.
                enableRowSelection: (c) => c.hasConfig && !!c.config,
                bulkActions: [
                  {
                    key: 'attach',
                    label: 'Attach to section',
                    icon: ArrowRight,
                    onTrigger: (rows) => {
                      setAttachSubjects(
                        rows
                          .filter((c) => c.hasConfig && c.config)
                          .map((c) => ({
                            subjectConfigId: c.config!.id,
                            code: c.code,
                            name: c.name,
                          }))
                      );
                      setAttachOpen(true);
                    },
                  },
                ],
              }}
              selectionResetSignal={selectionResetSignal}
              rowDetail={{
                // Every attached subject expands, one level or ten. The panel
                // is not a repeat of the collapsed line: its class chips are
                // the only way from this page into a grading sheet, and
                // single-level subjects used to list their classes as plain
                // text with no way to open one.
                render: (subject) => {
                  const impact = subject.config
                    ? sheetImpactByConfigId?.[subject.config.id]
                    : undefined;
                  if (
                    !impact ||
                    impact.totalSections === 0 ||
                    !expandedIds.has(subject.id)
                  ) {
                    return null;
                  }
                  return (
                    <ClassesPanel
                      subjectName={subject.name}
                      impact={impact}
                      onOpenSheets={setSheetsFor}
                    />
                  );
                },
              }}
              emptyFilteredState={{
                title: 'No subjects match.',
                body: 'Try clearing the search or the filters.',
              }}
            />
          </div>
        )}
      </Card>

      {/* Full-edit drawer — one Sheet mounted once, content swaps with
          `editSubject`. Opened either by a row's pencil, or by "Set
          weights" on a not-yet-configured row. */}
      <Sheet
        open={!!editSubject}
        onOpenChange={(open) => {
          if (!open) setEditSubject(null);
        }}
      >
        <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Pencil className="size-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {ayCode}
                </p>
                <SheetTitle>{editSubject?.name ?? 'Edit subject'}</SheetTitle>
                <SheetDescription>
                  Grade type, weights, and report mapping for this subject.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
          {/* The form owns the scroll and the pinned Cancel / Save row. */}
          <div className="flex min-h-0 flex-1 flex-col">
            {editSubject &&
              (editSubject.hasConfig ? (
                <SubjectConfigForm
                  mode="edit"
                  draft={draftFromRow(editSubject, ayCode)}
                  subjects={subjectOptions}
                  sheetImpact={sheetImpactByConfigId?.[editSubject.config!.id]}
                  onSaved={() => setEditSubject(null)}
                  onCancel={() => setEditSubject(null)}
                />
              ) : (
                <SubjectConfigForm
                  mode="create"
                  subject={subjectIdentity(editSubject)}
                  ayId={ayId}
                  ayCode={ayCode}
                  subjects={subjectOptions}
                  onSaved={() => setEditSubject(null)}
                  onCancel={() => setEditSubject(null)}
                />
              ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* A class's four terms, each opening the editor that already exists.
          Opened from a chip in the expanded row above, not from inside the
          config drawer, so nothing is nested. */}
      {sheetsFor && (
        <SectionTermSheetsDialog
          sheetId={sheetsFor.sheetId}
          sectionName={sheetsFor.sectionName}
          open
          onOpenChange={(next) => {
            if (!next) setSheetsFor(null);
          }}
        />
      )}

      {/* Add subject drawer. */}
      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber">
                <Plus className="size-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {levelLabel} catalog
                </p>
                <SheetTitle>Add subject</SheetTitle>
                <SheetDescription>
                  Creates a new catalog subject. Set its weights afterward — it
                  appears in the table above as &ldquo;Not set&rdquo; until you
                  do.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
          {/* The form owns the scroll and the pinned Cancel / Add row. */}
          <div className="flex min-h-0 flex-1 flex-col">
            {addOpen && (
              <NewSubjectForm
                // Just closes — the form awaits its own refresh now, so
                // refreshing here too would render the server twice.
                onSuccess={() => setAddOpen(false)}
                onCancel={() => setAddOpen(false)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AttachToSectionModal
        open={attachOpen}
        onOpenChange={setAttachOpen}
        subjects={attachSubjects}
        sections={sections}
        defaultLevelType={defaultSectionLevelType}
        onAttached={() => {
          setAttachSubjects([]);
          setSelectionResetSignal((n) => n + 1);
        }}
      />
    </>
  );
}

// The expanded "Classes taking {subject}" panel under a row.
//
// Ten levels stacked one per row left a wall of dead space to the right and
// pushed the next subject off screen. Flowing the groups into columns makes
// the panel SHORTER as the window gets wider, which is the opposite of how it
// read before.
function ClassesPanel({
  subjectName,
  impact,
  onOpenSheets,
}: {
  subjectName: string;
  impact: UsedByImpact;
  onOpenSheets: (target: { sheetId: string; sectionName: string }) => void;
}) {
  return (
    <div className="border-l-2 border-primary/30 px-5 py-3.5">
      <p className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Classes taking {subjectName} — click one to open its grading sheet
      </p>
      <div className="grid gap-x-7 gap-y-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {impact.sectionsByLevel.map((group) => (
          <div key={group.levelCode} className="flex items-start gap-2">
            <span className="mt-px inline-flex min-w-8 justify-center rounded-md bg-card px-1.5 py-1 font-mono text-[10px] font-bold tabular-nums text-muted-foreground ring-1 ring-border">
              {group.levelCode}
            </span>
            <span className="flex flex-wrap gap-1">
              {group.sections.map((section) => (
                <HoverHint
                  key={section.sheetId}
                  hint={
                    section.isLocked
                      ? `${section.name} · Term ${section.termNumber} sheet — locked. Open it to request a change.`
                      : `${section.name} · Term ${section.termNumber} sheet — open for entry. Set its max scores here.`
                  }
                  focusable={false}
                >
                  {/* Open is the normal state, so it carries no mark — the
                      green dot that used to mark it read as an "online"
                      badge. Only a locked sheet is marked; the arrow on hover
                      says the chip opens something. */}
                  <button
                    type="button"
                    onClick={() =>
                      onOpenSheets({
                        sheetId: section.sheetId,
                        sectionName: section.name,
                      })
                    }
                    className={cn(
                      'group/chip inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                      section.isLocked
                        ? 'border-dashed border-hairline-strong bg-muted text-muted-foreground hover:text-foreground'
                        : 'border-border bg-card text-ink-2 hover:border-primary/35 hover:bg-accent hover:text-primary'
                    )}
                  >
                    {section.isLocked && (
                      <Lock className="size-3 shrink-0 text-ink-5" />
                    )}
                    {section.name}
                    {!section.isLocked && (
                      <ArrowUpRight
                        className="-mr-1 size-3 shrink-0 opacity-0 transition-opacity group-hover/chip:opacity-100 motion-reduce:transition-none"
                        aria-hidden="true"
                      />
                    )}
                    <span className="sr-only">
                      {section.isLocked ? ' (locked)' : ' (open for entry)'}
                    </span>
                  </button>
                </HoverHint>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryCount({
  value,
  label,
  warn = false,
  danger = false,
}: {
  value: number;
  label: string;
  warn?: boolean;
  danger?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className={cn(
          'font-serif text-[18px] font-semibold tabular-nums leading-none text-foreground',
          warn && 'text-brand-amber',
          danger && 'text-destructive'
        )}
      >
        {value}
      </span>
      {label}
    </span>
  );
}

// Weights cell — three states: a deliberate "No sheet" chip
// (grading_method='no_sheet' — there ARE no weights by design, not a
// gap); "Not set" + an inline "Set weights" link (no subject_configs row
// yet — opens the same edit drawer the row's pencil does); or the
// WW / PT / QA bar, tinted by how the split compares to the standard.
function WeightsCell({
  subject,
  onFix,
}: {
  subject: CatalogSubjectRow;
  onFix: () => void;
}) {
  if (subject.grading_method === 'no_sheet') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground">
        No sheet
      </span>
    );
  }

  if (!subject.config) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-sm text-muted-foreground/70">Not set</span>
        <button
          type="button"
          onClick={onFix}
          className="text-xs font-semibold text-primary hover:underline"
        >
          Set weights
        </button>
      </span>
    );
  }

  const ww = Math.round(subject.config.ww_weight * 100);
  const pt = Math.round(subject.config.pt_weight * 100);
  const qa = Math.round(subject.config.qa_weight * 100);
  const profile = classifyProfile(subject.code, ww, pt, qa);

  return <ProfileWeightBar profile={profile} ww={ww} pt={pt} qa={qa} />;
}
