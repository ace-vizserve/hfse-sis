'use client';

import { ArrowRight, ListChecks, Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
}: {
  catalog: CatalogSubjectRow[];
  levelLabel: string;
  ayCode: string;
  ayId: string;
  /** Every section at this level type — the "Attach to section" modal's
   * picker. Just id/name/levelCode; no per-section subject state needed
   * anymore (attaching is a write, not something this page displays). */
  sections: AttachSection[];
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editSubject, setEditSubject] = useState<CatalogSubjectRow | null>(
    null
  );
  const [addOpen, setAddOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);

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
                  <TableHead>Weights (WW · PT · QA)</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalog.map((subject) => {
                  const checked = selectedIds.has(subject.id);
                  const attachable = subject.hasConfig && !!subject.config;
                  return (
                    <TableRow
                      key={subject.id}
                      className={cn('group', checked && 'bg-accent')}
                    >
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
  const profile = classifyProfile(ww, pt, qa);

  return <ProfileLegendChip profile={profile} label={`${ww}·${pt}·${qa}`} />;
}
