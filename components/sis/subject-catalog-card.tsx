'use client';

import {
  ArrowRight,
  ChevronDown,
  ListChecks,
  Lock,
  Pencil,
  Plus,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';

import {
  AttachToSectionModal,
  type AttachSection,
} from '@/components/sis/attach-to-section-modal';
import { NewSubjectForm } from '@/components/sis/new-subject-form';
import {
  SubjectConfigForm,
  type SubjectConfigFormDraft,
  type SubjectConfigFormSubject,
} from '@/components/sis/subject-config-form';
import {
  classifyProfile,
  ProfileLegendChip,
} from '@/components/sis/weight-profile';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
    report_label: row.report_label,
    ayCode,
    ww_weight: Math.round(cfg.ww_weight * 100),
    pt_weight: Math.round(cfg.pt_weight * 100),
    qa_weight: Math.round(cfg.qa_weight * 100),
    ww_max_slots: cfg.ww_max_slots,
    pt_max_slots: cfg.pt_max_slots,
    qa_max: cfg.qa_max,
    reportSubjectId: row.reportSubjectId,
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
 * the names cost a click.
 */
function UsedByCell({
  impact,
  expandable,
  isOpen,
  subjectName,
  onToggle,
}: {
  impact: UsedByImpact | undefined;
  expandable: boolean;
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

  const span = formatLevelSpan(impact.levelCodes);
  const count = `${impact.totalSections} ${impact.totalSections === 1 ? 'class' : 'classes'}`;

  if (!expandable) {
    // One level: the class names ARE the detail, so show them rather than
    // hiding a single line behind a control.
    return (
      <div className="flex flex-col gap-0.5 leading-tight">
        <span className="font-mono text-[11.5px] font-semibold tabular-nums text-foreground">
          {span}
        </span>
        <span className="text-[12px] text-muted-foreground">
          {impact.sectionsByLevel[0]?.sections.map((s) => s.name).join(', ')}
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className="-ml-2 inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-left transition-colors hover:border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      title={`${subjectName} — show the classes taking it`}
    >
      <span className="flex flex-col gap-0.5 leading-tight">
        <span className="font-mono text-[11.5px] font-semibold tabular-nums text-foreground">
          {span}
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
  );
}

function subjectIdentity(row: CatalogSubjectRow): SubjectConfigFormSubject {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    is_examinable: row.is_examinable,
    grading_method: row.grading_method,
    report_label: row.report_label,
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
}: {
  catalog: CatalogSubjectRow[];
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
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editSubject, setEditSubject] = useState<CatalogSubjectRow | null>(
    null
  );
  const [addOpen, setAddOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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

  function toggleSelected(subject: CatalogSubjectRow, checked: boolean) {
    if (!subject.hasConfig || !subject.config) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(subject.id);
      else next.delete(subject.id);
      return next;
    });
  }

  const selectedSubjects = catalog
    .filter((c) => selectedIds.has(c.id) && c.hasConfig && c.config)
    .map((c) => ({
      subjectConfigId: c.config!.id,
      code: c.code,
      name: c.name,
    }));

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

        {catalog.length === 0 ? (
          <div className="border-t border-border px-5 py-10 text-center text-sm text-muted-foreground">
            Nothing in the catalog for this level yet. Click{' '}
            <strong>Add subject</strong> above to add the first one.
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-10" />
                  <TableHead>Subject</TableHead>
                  <TableHead>Used by</TableHead>
                  <TableHead>Weights (WW · PT · QA)</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalog.map((subject) => {
                  const checked = selectedIds.has(subject.id);
                  const attachable = subject.hasConfig && !!subject.config;
                  const impact = subject.config
                    ? sheetImpactByConfigId?.[subject.config.id]
                    : undefined;
                  // Only offer an expander when a row genuinely hides more
                  // than it shows — a chevron opening onto the same one line
                  // is a lie. Single-level subjects list their classes inline.
                  const expandable = (impact?.sectionsByLevel.length ?? 0) > 1;
                  const isOpen = expandedIds.has(subject.id);
                  return (
                    <Fragment key={subject.id}>
                      <TableRow className={cn('group', checked && 'bg-accent')}>
                        <TableCell>
                          <Checkbox
                            checked={checked}
                            disabled={!attachable}
                            onCheckedChange={(v) =>
                              toggleSelected(subject, v === true)
                            }
                            aria-label={`${subject.name} — ${checked ? 'selected' : 'not selected'}`}
                            title={
                              attachable
                                ? undefined
                                : 'Not attachable yet — set its weights first'
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 leading-tight">
                            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              {subject.code}
                            </span>
                            <span className="font-serif text-[14px] font-semibold text-foreground">
                              {subject.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <UsedByCell
                            impact={impact}
                            expandable={expandable}
                            isOpen={isOpen}
                            subjectName={subject.name}
                            onToggle={() => toggleExpanded(subject.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <WeightsCell
                            subject={subject}
                            onFix={() => setEditSubject(subject)}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                            onClick={() => setEditSubject(subject)}
                            aria-label={`Edit ${subject.name}`}
                            title={`Edit ${subject.name}`}
                          >
                            <Pencil className="size-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expandable && isOpen && impact ? (
                        <TableRow className="hover:bg-transparent">
                          {/* Ten levels stacked one per row left a wall of
                              dead space to the right and pushed the next
                              subject off screen. Flowing the groups into
                              columns makes the panel SHORTER as the window
                              gets wider, which is the opposite of how it
                              read before. */}
                          <TableCell
                            colSpan={5}
                            className="border-t-0 bg-muted/30 p-0"
                          >
                            <div className="border-l-2 border-primary/30 px-5 py-3.5">
                              <p className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                Classes taking {subject.name} — click one to
                                open its grading sheet
                              </p>
                              <div className="grid gap-x-7 gap-y-2.5 sm:grid-cols-2 xl:grid-cols-3">
                                {impact.sectionsByLevel.map((group) => (
                                  <div
                                    key={group.levelCode}
                                    className="flex items-start gap-2"
                                  >
                                    <span className="mt-px inline-flex min-w-8 justify-center rounded-md bg-card px-1.5 py-1 font-mono text-[10px] font-bold tabular-nums text-muted-foreground ring-1 ring-border">
                                      {group.levelCode}
                                    </span>
                                    <span className="flex flex-wrap gap-1">
                                      {group.sections.map((section) => (
                                        <Link
                                          key={section.sheetId}
                                          href={`/markbook/grading/${section.sheetId}`}
                                          className="inline-flex items-center gap-1.5 rounded-md bg-card px-2 py-1 text-[11px] leading-none text-foreground ring-1 ring-border transition-colors hover:bg-accent hover:ring-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                          title={
                                            section.isLocked
                                              ? `${section.name} · Term ${section.termNumber} sheet — locked. Open it to request a change.`
                                              : `${section.name} · Term ${section.termNumber} sheet — open for entry. Set its max scores here.`
                                          }
                                        >
                                          {section.name}
                                          {section.isLocked ? (
                                            <Lock className="size-2.5 shrink-0 text-muted-foreground" />
                                          ) : (
                                            <span
                                              className="size-1.5 shrink-0 rounded-full bg-brand-mint"
                                              aria-hidden="true"
                                            />
                                          )}
                                          <span className="sr-only">
                                            {section.isLocked
                                              ? ' (locked)'
                                              : ' (open for entry)'}
                                          </span>
                                        </Link>
                                      ))}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Sticky selection bar — appears once ≥1 attachable subject is
          checked, hides (not unmounted, so its slide-out transition can
          run) otherwise. Lives OUTSIDE the Card so `sticky` isn't clipped
          by the Card's own `overflow-hidden`. */}
      <div
        className={cn(
          'sticky bottom-4 z-10 mt-4 flex items-center justify-between gap-3 rounded-xl bg-brand-navy px-5 py-3 text-white shadow-lg transition-all duration-150',
          selectedSubjects.length === 0 &&
            'pointer-events-none translate-y-6 opacity-0'
        )}
      >
        <span className="text-sm">
          <strong>{selectedSubjects.length}</strong> subject
          {selectedSubjects.length === 1 ? '' : 's'} selected
        </span>
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={selectedSubjects.length === 0}
          onClick={() => setAttachOpen(true)}
        >
          Attach to section
          <ArrowRight className="size-3.5" />
        </Button>
      </div>

      {/* Full-edit drawer — one Sheet mounted once, content swaps with
          `editSubject`. Opened either by a row's pencil, or by "Set
          weights" on a not-yet-configured row. */}
      <Sheet
        open={!!editSubject}
        onOpenChange={(open) => {
          if (!open) setEditSubject(null);
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
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
          <div className="px-1 py-5">
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

      {/* Add subject drawer. */}
      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
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
          <div className="px-1 py-5">
            {addOpen && (
              <NewSubjectForm
                onSuccess={() => {
                  setAddOpen(false);
                  router.refresh();
                }}
                onCancel={() => setAddOpen(false)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AttachToSectionModal
        open={attachOpen}
        onOpenChange={setAttachOpen}
        subjects={selectedSubjects}
        sections={sections}
        defaultLevelType={defaultSectionLevelType}
        onAttached={() => setSelectedIds(new Set())}
      />
    </>
  );
}

// Weights cell — three states: a deliberate "No sheet" chip
// (grading_method='no_sheet' — there ARE no weights by design, not a
// gap); "Not set" + an inline "Set weights" link (no subject_configs row
// yet — opens the same edit drawer the row's pencil does); or the
// WW·PT·QA profile chip.
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

  return <ProfileLegendChip profile={profile} label={`${ww}·${pt}·${qa}`} />;
}
