'use client';

import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { toast } from 'sonner';

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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { useTrackFilter } from '@/lib/sis/subject-track-filter-store';
import type { CatalogSubjectRow } from '@/lib/sis/subjects/queries';
import { subjectCodesForTrack } from '@/lib/sis/track-bundles';
import { cn } from '@/lib/utils';

// Step ① "Subjects" — the merged catalog + tune table (Task 2 of the
// "Unified Subject Setup page" plan; Task 1 built the stub this replaces).
// Every subject offered (or offerable) at the picked level is one row:
// Subject / Track (Secondary only) / Grade type / Weights / Reports as /
// Offered. Three interaction surfaces per the plan's interaction model —
// none of them ever opens a further dialog from within itself:
//   1. Tri-state Offered `Switch`, fanned out client-side across every
//      individual level of this type — MIXED requires an explicit confirm
//      before collapsing to all-on/all-off.
//   2. A flagged ("needs attention") row expands IN PLACE via
//      `Collapsible`, rendering `SubjectConfigForm` inline.
//   3. Every row (flagged or not) has a pencil Edit affordance opening the
//      SAME form in a `Sheet` drawer instead — the deliberate full-edit
//      path. Opening one of (2)/(3) for a row always closes the other, so
//      a subject never has two simultaneously-open editors.
// "+ Add subject" opens `NewSubjectForm` in its own Sheet drawer, posting
// to POST /catalog — a fresh, still-unconfigured subject shows up as just
// another (flagged) row on refresh, no special-casing needed.

const GLOBAL_TRACK_CODES = new Set(subjectCodesForTrack('Global'));
const STANDARD_TRACK_CODES = new Set(subjectCodesForTrack('Standard'));

type Track = 'global' | 'standard' | 'both' | null;

// Which curriculum track bundle(s) a subject code belongs to — `null` for
// subjects that are neither (e.g. Filipino/Mandarin, attached per-section
// ad hoc via the Mother-Tongue radio, never through a bundle). Reused for
// both the Track column's display AND the header's Track view-filter.
function trackForCode(code: string): Track {
  const inGlobal = GLOBAL_TRACK_CODES.has(code);
  const inStandard = STANDARD_TRACK_CODES.has(code);
  if (inGlobal && inStandard) return 'both';
  if (inGlobal) return 'global';
  if (inStandard) return 'standard';
  return null;
}

const TRACK_LABEL: Record<Exclude<Track, null>, string> = {
  global: 'Global',
  standard: 'Standard',
  both: 'Both',
};

type LevelOption = { id: string; code: string; label: string };

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
  levelsOfType,
  bare = false,
}: {
  catalog: CatalogSubjectRow[];
  levelLabel: string;
  ayCode: string;
  ayId: string;
  /** Every individual level of the picked type actually offered this AY —
   * the fan-out target set for the Offered toggle's PUT /level-offerings
   * calls (one per level, matching KD #153's core+offered-volatile set
   * `app/(sis)/sis/admin/subjects/page.tsx` already computes for the
   * Advanced tab). */
  levelsOfType: LevelOption[];
  /** True when a parent already supplies the Card chrome + title/badge
   * (the collapsible "Subject catalog" summary bar on the Setup page) —
   * skips this component's own icon-tile header, keeping only the "+ Add
   * subject" toolbar row and the table itself. */
  bare?: boolean;
}) {
  const router = useRouter();
  const levelType =
    levelLabel.toLowerCase() === 'secondary' ? 'secondary' : 'primary';
  const [trackFilterValue] = useTrackFilter();
  // The Track view-filter is Secondary-only (Global/Standard only exist as
  // a Secondary concept, lib/sis/track-bundles.ts) — a Primary view ignores
  // whatever the store last held rather than rendering a meaningless filter.
  const trackFilter = levelType === 'secondary' ? trackFilterValue : 'all';

  // Mutually-exclusive row-editor state — opening one closes the other, so
  // a subject never has two simultaneously-open editors (the plan's
  // explicit guard).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState<CatalogSubjectRow | null>(
    null
  );
  const [addOpen, setAddOpen] = useState(false);

  function toggleInlineFix(id: string) {
    setEditSubject(null);
    setExpandedId((cur) => (cur === id ? null : id));
  }
  function openEditDrawer(subject: CatalogSubjectRow) {
    setExpandedId(null);
    setEditSubject(subject);
  }

  const needsAttentionCount = catalog.filter((c) => c.needsAttention).length;
  const subjectOptions = catalog.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
  }));

  const visibleRows =
    trackFilter === 'all'
      ? catalog
      : catalog.filter((c) => {
          const track = trackForCode(c.code);
          return track === trackFilter || track === 'both';
        });

  const columnCount = levelType === 'secondary' ? 6 : 5;

  const Root = bare ? 'div' : Card;
  const rootProps = bare ? {} : { className: 'gap-0 overflow-hidden py-0' };

  return (
    <Root {...rootProps}>
      {bare ? (
        <div className="flex justify-end px-5 pb-3 pt-4">
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
      ) : (
        <div className="flex flex-wrap items-center gap-3 px-5 pb-4 pt-5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <ListChecks className="size-4" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              ① Subjects
            </p>
            <p className="truncate font-serif text-[16px] font-semibold text-foreground">
              {levelLabel}&apos;s catalog for {ayCode}
            </p>
          </div>
          {needsAttentionCount > 0 && (
            <Badge variant="warning" className="shrink-0 gap-1">
              <AlertTriangle className="size-3" />
              {needsAttentionCount} need{needsAttentionCount === 1 ? 's' : ''}{' '}
              attention
            </Badge>
          )}
          <Button
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-3.5" />
            Add subject
          </Button>
        </div>
      )}

      {catalog.length === 0 ? (
        <div className="border-t border-border px-5 py-10 text-center text-sm text-muted-foreground">
          Nothing in the catalog for this level yet. Click{' '}
          <strong>Add subject</strong> above to add the first one.
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="border-t border-border px-5 py-10 text-center text-sm text-muted-foreground">
          No subjects match the{' '}
          {trackFilter === 'global' ? 'Global' : 'Standard'} track filter.
        </div>
      ) : (
        <div className="overflow-x-auto border-t border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Subject</TableHead>
                {levelType === 'secondary' && <TableHead>Track</TableHead>}
                <TableHead>Grade type</TableHead>
                <TableHead>Weights</TableHead>
                <TableHead>Reports as</TableHead>
                <TableHead>Offered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((subject) => {
                const isExpanded = expandedId === subject.id;
                const track = trackForCode(subject.code);

                return (
                  <Fragment key={subject.id}>
                    <TableRow className="group">
                      <TableCell>
                        <div className="flex items-center gap-2 leading-tight">
                          <div className="flex min-w-0 flex-col items-start gap-1">
                            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              {subject.code}
                            </span>
                            <span className="font-serif text-[14px] font-semibold text-foreground">
                              {subject.name}
                            </span>
                          </div>
                          {subject.needsAttention ? (
                            // Flagged rows get exactly one edit affordance —
                            // this pill, which opens the SAME inline quick-fix
                            // as the pencil would elsewhere. No pencil is
                            // rendered alongside it (a row never shows two
                            // competing ways to edit the same thing).
                            <button
                              type="button"
                              onClick={() => toggleInlineFix(subject.id)}
                              aria-expanded={isExpanded}
                              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-amber-light px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-brand-amber transition-colors hover:bg-brand-amber/20"
                            >
                              <AlertTriangle className="size-2.5" />
                              Needs attention
                              <ChevronDown
                                className={cn(
                                  'size-2.5 transition-transform',
                                  isExpanded && 'rotate-180'
                                )}
                              />
                            </button>
                          ) : (
                            // Already-confirmed rows get the deliberate full-
                            // edit path instead — a quiet pencil, visible on
                            // row hover/focus so it doesn't add permanent
                            // per-row chrome to every line of the table.
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                              onClick={() => openEditDrawer(subject)}
                              aria-label={`Edit ${subject.name}`}
                              title={`Edit ${subject.name}`}
                            >
                              <Pencil className="size-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>

                      {levelType === 'secondary' && (
                        <TableCell>
                          {track ? (
                            <Badge variant="secondary">
                              {TRACK_LABEL[track]}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </TableCell>
                      )}

                      <TableCell>
                        <Badge variant="secondary">
                          {subject.is_examinable ? 'Numeric' : 'Letter'}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <WeightsCell subject={subject} />
                      </TableCell>

                      <TableCell>
                        {subject.reportSubjectCode === subject.code ? (
                          <span className="text-muted-foreground/60">—</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                            <span aria-hidden>→</span>
                            {subject.reportSubjectCode}
                          </span>
                        )}
                      </TableCell>

                      <TableCell>
                        <OfferedToggle
                          subject={subject}
                          levelsOfType={levelsOfType}
                          levelLabel={levelLabel}
                          ayId={ayId}
                        />
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow className="bg-muted/10 hover:bg-muted/10">
                        <TableCell colSpan={columnCount} className="p-0">
                          <Collapsible open={isExpanded}>
                            <CollapsibleContent>
                              <div className="border-t border-dashed border-brand-amber/30 p-5">
                                {subject.hasConfig ? (
                                  <SubjectConfigForm
                                    mode="edit"
                                    draft={draftFromRow(subject, ayCode)}
                                    subjects={subjectOptions}
                                    onSaved={() => setExpandedId(null)}
                                    onCancel={() => setExpandedId(null)}
                                  />
                                ) : (
                                  <SubjectConfigForm
                                    mode="create"
                                    subject={subjectIdentity(subject)}
                                    ayId={ayId}
                                    ayCode={ayCode}
                                    subjects={subjectOptions}
                                    onSaved={() => setExpandedId(null)}
                                    onCancel={() => setExpandedId(null)}
                                  />
                                )}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Full-edit drawer — one Sheet mounted once, content swaps with
          `editSubject`. Every row's pencil affordance opens this, flagged
          or not (the flagged row's Collapsible above is the QUICK fix;
          this is the deliberate full edit). */}
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

      {/* Add subject drawer — per the plan's explicit "side drawer, not a
          centered dialog" requirement; the catalog table stays
          visible/scrollable behind it (Sheet's default portal + overlay
          behavior, verified against every other Sheet usage in this
          codebase — none block background scroll of content behind the
          overlay). Creates only the `subjects` catalog row; a freshly
          added subject appears below as just another (flagged) row on
          refresh — no special-casing. */}
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
                  Creates a new catalog subject. Set its weights and level
                  offerings afterward — it appears below, flagged for attention,
                  until you do.
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
    </Root>
  );
}

// Weights cell — three states: a deliberate "No sheet" chip
// (grading_method='no_sheet', so there ARE no weights by design, not a
// gap); "Not set" (no subject_configs row — plain muted text, not a
// second amber badge, since the row's own "Needs attention" pill already
// flags this exact gap once); or the WW·PT·QA profile chip. An
// unconfirmed (migration 085 `weights_confirmed=false`, the GP/COMP/ARTD/
// PESTD case) row also relies on that same pill rather than repeating it.
function WeightsCell({ subject }: { subject: CatalogSubjectRow }) {
  if (subject.grading_method === 'no_sheet') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground">
        No sheet
      </span>
    );
  }

  if (!subject.config) {
    return <span className="text-sm text-muted-foreground/70">Not set</span>;
  }

  const ww = Math.round(subject.config.ww_weight * 100);
  const pt = Math.round(subject.config.pt_weight * 100);
  const qa = Math.round(subject.config.qa_weight * 100);
  const profile = classifyProfile(ww, pt, qa);

  return <ProfileLegendChip profile={profile} label={`${ww}·${pt}·${qa}`} />;
}

// Tri-state Offered toggle — fanned out client-side across every level of
// this type (no new bulk route needed; PUT /level-offerings is idempotent
// + cheap to call N times, N = levels in the picked type). Clicking an
// ON/OFF row flips it directly; clicking a MIXED row opens an explicit
// confirm naming both directions before it collapses — never a silent
// overwrite.
function OfferedToggle({
  subject,
  levelsOfType,
  levelLabel,
  ayId,
}: {
  subject: CatalogSubjectRow;
  levelsOfType: LevelOption[];
  levelLabel: string;
  ayId: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const setOfferedMutation = useMutation({
    mutationFn: (target: boolean) =>
      Promise.all(
        levelsOfType.map((level) =>
          apiFetch(
            '/api/sis/admin/subjects/level-offerings',
            jsonInit('PUT', {
              subject_id: subject.id,
              level_id: level.id,
              academic_year_id: ayId,
              offered: target,
            })
          )
        )
      ),
    onSuccess: (_data, target) => {
      toast.success(
        `${subject.code} is now ${target ? 'offered' : 'not offered'} at every ${levelLabel} level`
      );
      setConfirmOpen(false);
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Could not update offering');
    },
  });
  const busy = setOfferedMutation.isPending;

  function handleCheckedChange() {
    if (subject.offeringState === 'mixed') {
      setConfirmOpen(true);
      return;
    }
    setOfferedMutation.mutate(subject.offeringState !== 'on');
  }

  const stateLabel =
    subject.offeringState === 'on'
      ? 'Offered at every level'
      : subject.offeringState === 'off'
        ? 'Not offered'
        : 'Offered at some levels, not others';

  return (
    <>
      <Switch
        checked={subject.offeringState === 'on'}
        onCheckedChange={handleCheckedChange}
        disabled={busy || levelsOfType.length === 0}
        aria-label={`Offered — ${subject.name} — ${stateLabel}`}
        title={stateLabel}
        className={
          subject.offeringState === 'mixed'
            ? 'ring-2 ring-brand-amber/50 ring-offset-1'
            : undefined
        }
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {subject.name} is offered at some levels, not others
            </AlertDialogTitle>
            <AlertDialogDescription>
              Currently offered at {subject.offeredLevelIds.length} of{' '}
              {levelsOfType.length} {levelLabel} levels. Choose how to resolve
              it — for finer per-level control, use the Advanced tab instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOfferedMutation.mutate(false)}
              disabled={busy}
              className="gap-1.5"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Turn off everywhere
            </Button>
            <Button
              type="button"
              onClick={() => setOfferedMutation.mutate(true)}
              disabled={busy}
              className="gap-1.5"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Turn on everywhere
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
