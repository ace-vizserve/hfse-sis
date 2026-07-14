'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  ArrowRight,
  CalendarRange,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
} from 'lucide-react';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { RowActionsMenu } from '@/components/ui/data-table';
import { cn } from '@/lib/utils';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  LEVEL_TYPE_VALUES,
  LevelAdminCreateSchema,
  type LevelAdminCreateInput,
  type LevelType,
} from '@/lib/schemas/level';
import type { LevelRow } from '@/lib/sis/levels';
import type { LevelDemandRow } from '@/lib/sis/level-demand';
import {
  groupTransitionsByFromLevel,
  type LevelTransitionRow,
} from '@/lib/sis/level-transitions';
import {
  PROFILE_LABEL,
  ProfileLegendChip,
} from '@/components/sis/weight-profile';

// Grade Levels admin — Levels & Grade Progression, Phase 3 (migration 078).
// One Card of ordered rows (sort_order, already sorted by getLevelRows).
// Each row: code / label / type chip / weight-profile chip / Core badge OR
// offered Switch / demand chip / ⋯ actions.
//
// The "Next level" picker was removed (2026-07-14) — see page.tsx's header
// comment for why. "Smart sync" (unmatched levelApplied names → one-click
// add to catalog) and "Observed progression" (real cross-AY transition
// report) replace it below the catalog card.

const LEVEL_TYPE_LABEL: Record<LevelType, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  preschool: 'Preschool',
};

type Props = {
  levels: LevelRow[];
  offeredLevelIds: string[];
  demandRows: LevelDemandRow[];
  transitionRows: LevelTransitionRow[];
  currentAyCode: string;
  currentAyId: string;
  acceptingAyCode: string | null;
  priorAyCode: string | null;
};

export function LevelsManagerClient({
  levels,
  offeredLevelIds,
  demandRows,
  transitionRows,
  currentAyCode,
  currentAyId,
  acceptingAyCode,
  priorAyCode,
}: Props) {
  const offeredSet = React.useMemo(
    () => new Set(offeredLevelIds),
    [offeredLevelIds]
  );
  const demandByLevelId = React.useMemo(() => {
    const m = new Map<string, LevelDemandRow>();
    for (const d of demandRows) {
      if (d.levelId) m.set(d.levelId, d);
    }
    return m;
  }, [demandRows]);

  // Demand rows that matched no level in the catalog at all — typos, or a
  // level applicants are naming that genuinely doesn't exist here yet
  // (e.g. the portal's "HFSE Global Education Programme – Year 8" not
  // matching the catalog's differently-worded label). Highest-value signal
  // in the demand data — surfaced as one-click "Sync" actions below, not a
  // passive banner.
  const unmatchedDemand = React.useMemo(
    () => demandRows.filter((d) => d.levelId === null && d.count > 0),
    [demandRows]
  );

  const coreCount = levels.filter((l) => l.isCore).length;

  return (
    <div className="space-y-4">
      <Card className="@container/card gap-0 overflow-hidden py-0">
        <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-4">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Layers className="size-4" />
          </div>
          <div className="leading-tight">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Grade level catalog · offerings shown for {currentAyCode}
            </p>
            <p className="font-serif text-[16px] font-semibold tabular-nums text-foreground">
              {levels.length} levels
              <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">
                {coreCount} permanent
              </span>
            </p>
          </div>
        </div>

        {levels.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Layers className="size-5" />
            </div>
            <div className="font-serif text-lg font-semibold text-foreground">
              No grade levels yet
            </div>
            <p className="max-w-md text-sm text-muted-foreground">
              Core levels (Primary 1 – Secondary 4) are seeded automatically. If
              this list is empty, something went wrong with setup — contact IT.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {levels.map((level) => (
              <LevelRowItem
                key={level.id}
                level={level}
                offered={level.isCore || offeredSet.has(level.id)}
                demand={demandByLevelId.get(level.id) ?? null}
                currentAyId={currentAyId}
                currentAyCode={currentAyCode}
                acceptingAyCode={acceptingAyCode}
              />
            ))}
          </ul>
        )}
      </Card>

      <SmartSyncPanel
        unmatchedDemand={unmatchedDemand}
        levels={levels}
        acceptingAyCode={acceptingAyCode}
      />

      <ObservedProgressionPanel
        transitionRows={transitionRows}
        levels={levels}
        priorAyCode={priorAyCode}
        acceptingAyCode={acceptingAyCode}
      />

      <p className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {currentAyCode || '—'} · {levels.length} level
        {levels.length === 1 ? '' : 's'} · {coreCount} permanent · every change
        is audit-logged
      </p>
    </div>
  );
}

// =====================================================================
// Smart sync — applied-for level names with zero catalog match. Each row
// is a real, one-click path to fixing the gap: click Sync, the Add-level
// dialog opens pre-filled with the observed label, the registrar confirms
// code/type/position and saves. Not a blind auto-create — code and level
// type need a human call (they drive the grading profile), so "synced"
// here means "friction removed," not "silently created."
// =====================================================================

function SmartSyncPanel({
  unmatchedDemand,
  levels,
  acceptingAyCode,
}: {
  unmatchedDemand: LevelDemandRow[];
  levels: LevelRow[];
  acceptingAyCode: string | null;
}) {
  const [syncLabel, setSyncLabel] = React.useState<string | null>(null);

  if (unmatchedDemand.length === 0) return null;

  return (
    <Card className="@container/card gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-3 border-b border-border bg-brand-amber/5 px-5 py-4">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber">
          <Sparkles className="size-4" />
        </div>
        <div className="leading-tight">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Smart sync
          </p>
          <p className="font-serif text-[16px] font-semibold text-foreground">
            {unmatchedDemand.length} level name
            {unmatchedDemand.length === 1 ? '' : 's'} not in the catalog
          </p>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {unmatchedDemand.map((d) => (
          <li
            key={d.label}
            className="flex items-center justify-between gap-3 px-5 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                &ldquo;{d.label}&rdquo;
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {d.count} applicant{d.count === 1 ? '' : 's'}
                {acceptingAyCode ? ` in ${acceptingAyCode}` : ''}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => setSyncLabel(d.label)}
            >
              <Sparkles className="size-3.5" />
              Sync
            </Button>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
        Likely a level applicants are naming that isn&apos;t in the catalog yet
        — or a typo. Sync to add it, or correct the application record.
      </p>

      <AddLevelDialog
        levels={levels}
        open={syncLabel !== null}
        onOpenChange={(open) => {
          if (!open) setSyncLabel(null);
        }}
        initialLabel={syncLabel ?? undefined}
      />
    </Card>
  );
}

// =====================================================================
// Observed progression — real, evidence-based transition report. For each
// level, shows what returning students who were placed there LAST AY
// actually applied for THIS AY (cross-referenced by studentNumber, Hard
// Rule #4). Naturally one-to-many: a level branches into every destination
// that actually happened, not a single hand-picked "next level." Nothing
// here is editable — it's a report, computed fresh every load.
// =====================================================================

function ObservedProgressionPanel({
  transitionRows,
  levels,
  priorAyCode,
  acceptingAyCode,
}: {
  transitionRows: LevelTransitionRow[];
  levels: LevelRow[];
  priorAyCode: string | null;
  acceptingAyCode: string | null;
}) {
  const levelById = React.useMemo(
    () => new Map(levels.map((l) => [l.id, l])),
    [levels]
  );
  const grouped = React.useMemo(
    () => groupTransitionsByFromLevel(transitionRows),
    [transitionRows]
  );
  const fromLevelIds = React.useMemo(
    () =>
      Array.from(grouped.keys()).sort(
        (a, b) =>
          (levelById.get(a)?.sortOrder ?? 999) -
          (levelById.get(b)?.sortOrder ?? 999)
      ),
    [grouped, levelById]
  );

  return (
    <Card className="@container/card gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-4">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <TrendingUp className="size-4" />
        </div>
        <div className="leading-tight">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Observed progression
          </p>
          <p className="font-serif text-[16px] font-semibold text-foreground">
            Where {priorAyCode ?? 'last AY'}&apos;s students actually applied
          </p>
        </div>
      </div>

      {fromLevelIds.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
          <p className="max-w-md text-sm text-muted-foreground">
            No returning-student applications matched against{' '}
            {priorAyCode ?? 'a prior AY'}&apos;s roster yet
            {acceptingAyCode ? ` for ${acceptingAyCode}` : ''}.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {fromLevelIds.map((fromId) => {
            const fromLevel = levelById.get(fromId);
            const destinations = grouped.get(fromId) ?? [];
            return (
              <li
                key={fromId}
                className="flex flex-wrap items-center gap-3 px-5 py-3"
              >
                <span className="w-40 shrink-0 font-serif text-[14px] font-semibold text-foreground">
                  {fromLevel?.label ?? fromId}
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                <div className="flex flex-1 flex-wrap items-center gap-1.5">
                  {destinations.map((d) => (
                    <Badge
                      key={d.toLabel}
                      variant={d.toLevelId ? 'outline' : 'warning'}
                      className="gap-1 font-normal"
                    >
                      {d.toLabel}
                      <span className="tabular-nums">· {d.count}</span>
                    </Badge>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
        Computed from real applications, not a maintained list — a level
        genuinely branches to every destination its own students actually chose.
        Amber chips are level names not yet in the catalog (see Smart sync
        above).
      </p>
    </Card>
  );
}

// =====================================================================
// AY switcher — same idiom as SubjectAySwitcher. Exported so page.tsx's
// SisPageHeader can render it in the header chips slot (matching how
// Subjects' page already puts its own AY badge + switcher in the header,
// not a separate floating strip).
// =====================================================================

export function LevelsAySwitcher({
  current,
  options,
}: {
  current: string;
  options: Array<{ ayCode: string; label: string; isCurrent: boolean }>;
}) {
  const router = useRouter();

  function onChange(next: string) {
    if (next === current) return;
    router.push(`/sis/admin/levels?ay=${encodeURIComponent(next)}`);
    // Same route + changed ?ay= → force the RSC to re-fetch offerings for
    // the new AY (the client Router Cache would otherwise replay the prior
    // AY's rows until a hard reload).
    router.refresh();
  }

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-auto gap-1.5 border-border bg-card px-3 text-[10px] font-semibold uppercase tracking-[0.14em]">
        <SelectValue placeholder="Pick AY" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.ayCode} value={o.ayCode} className="text-xs">
            <div className="flex items-center gap-2">
              <CalendarRange className="size-4 text-muted-foreground" />
              {o.ayCode}
              {o.isCurrent && (
                <span className="ml-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                  current
                </span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// =====================================================================
// Row — 3 clusters (Identity / Offering / Actions), separated by a thin
// border-l divider. The "Progression" cluster (Next-level picker) was
// removed 2026-07-14 — see page.tsx's header comment.
// =====================================================================

function LevelRowItem({
  level,
  offered,
  demand,
  currentAyId,
  currentAyCode,
  acceptingAyCode,
}: {
  level: LevelRow;
  offered: boolean;
  demand: LevelDemandRow | null;
  currentAyId: string;
  currentAyCode: string;
  acceptingAyCode: string | null;
}) {
  const showDemandChip = demand !== null && !demand.offered && demand.count > 0;

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-4">
      {/* Identity: code / label / type / weight-profile */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
        <Badge
          variant="outline"
          className="h-6 shrink-0 border-border bg-card px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
        >
          {level.code}
        </Badge>

        <div className="min-w-[9rem] flex-1 font-serif text-[15px] font-semibold tracking-tight text-foreground">
          {level.label}
        </div>

        <Badge variant="secondary" className="shrink-0">
          {LEVEL_TYPE_LABEL[level.levelType]}
        </Badge>

        {level.levelType === 'preschool' ? (
          <Badge variant="muted" className="shrink-0">
            No grading profile
          </Badge>
        ) : (
          <ProfileLegendChip
            profile={level.levelType}
            label={PROFILE_LABEL[level.levelType]}
          />
        )}
      </div>

      {/* Offering: demand signal + Core badge / offered Switch */}
      <div className="ml-auto flex shrink-0 items-center gap-2 border-l border-border pl-3">
        {showDemandChip && demand && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="warning" className="shrink-0 gap-1">
                <Users className="size-3" />
                <span className="tabular-nums">{demand.count}</span> applicant
                {demand.count === 1 ? '' : 's'} — not offered
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {demand.count} application{demand.count === 1 ? '' : 's'} for{' '}
              {level.label}
              {acceptingAyCode ? ` in ${acceptingAyCode}` : ''}, but this level
              isn&apos;t offered that year.
            </TooltipContent>
          </Tooltip>
        )}
        {level.isCore ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="muted">Core</Badge>
            </TooltipTrigger>
            <TooltipContent>Permanent — always offered</TooltipContent>
          </Tooltip>
        ) : (
          <OfferedSwitch
            level={level}
            offered={offered}
            currentAyId={currentAyId}
            currentAyCode={currentAyCode}
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center border-l border-border pl-2">
        <LevelRowActions level={level} />
      </div>
    </li>
  );
}

// =====================================================================
// Offered Switch — volatile levels only, bound to the AY switcher above.
// Tier-1 optimistic (onMutate snapshot + rollback), KD #24.
// =====================================================================

function OfferedSwitch({
  level,
  offered,
  currentAyId,
  currentAyCode,
}: {
  level: LevelRow;
  offered: boolean;
  currentAyId: string;
  currentAyCode: string;
}) {
  const router = useRouter();
  const [checked, setChecked] = React.useState(offered);

  React.useEffect(() => {
    setChecked(offered);
  }, [offered]);

  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      apiFetch(
        `/api/sis/admin/levels/${level.id}/offering`,
        jsonInit('PUT', { academicYearId: currentAyId, offered: next })
      ),
    onMutate: (next) => {
      const prev = checked;
      setChecked(next);
      return { prev };
    },
    onError: (e, _next, ctx) => {
      if (ctx) setChecked(ctx.prev);
      toast.error(
        e instanceof Error ? e.message : 'Could not update the offering'
      );
    },
    onSuccess: (_data, next) => {
      toast.success(
        `${level.label} ${next ? 'now offered' : 'shelved'} in ${currentAyCode}`
      );
      router.refresh();
    },
  });

  return (
    <div className="flex items-center gap-1.5">
      <Switch
        checked={checked}
        onCheckedChange={(v) => mutation.mutate(v)}
        disabled={!currentAyId || mutation.isPending}
        aria-label={`Offer ${level.label} in ${currentAyCode}`}
      />
      <span className="w-14 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {checked ? 'Offered' : 'Shelved'}
      </span>
    </div>
  );
}

// =====================================================================
// Row ⋯ menu — Edit (dialog) + Delete (AlertDialog confirm, disabled-with-
// reason on core).
// =====================================================================

function LevelRowActions({ level }: { level: LevelRow }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/sis/admin/levels/${level.id}`, jsonInit('DELETE')),
    onSuccess: () => {
      toast.success(`Removed ${level.label}`);
      setConfirmOpen(false);
      router.refresh();
    },
    onError: (e) => {
      // 409 ("has classes or subject settings on record") surfaces verbatim.
      toast.error(
        e instanceof Error ? e.message : 'Could not remove this level'
      );
    },
  });

  return (
    <>
      <RowActionsMenu>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setEditOpen(true);
          }}
        >
          <Pencil className="size-4" />
          Edit
        </DropdownMenuItem>
        {level.isCore ? (
          <DropdownMenuItem
            disabled
            className="flex-col items-start gap-0.5 whitespace-normal"
          >
            <span className="flex items-center gap-2">
              <Trash2 className="size-4" />
              Delete
            </span>
            <span className="pl-6 text-[11px] text-muted-foreground">
              Core levels are permanent
            </span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setConfirmOpen(true);
            }}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        )}
      </RowActionsMenu>

      <EditLevelDialog
        level={level}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {level.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the level from the catalog and its offerings across
              every school year. If any classes or subject settings already use
              it, the removal will be blocked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
              variant="destructive"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1 size-3.5" />
              )}
              {deleteMutation.isPending ? 'Removing…' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// =====================================================================
// Edit level — label + position. `code` and `levelType` aren't editable
// here (mirrors LevelAdminUpdateSchema — the route doesn't accept them
// either).
// =====================================================================

const EditLevelFormSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'Label required')
    .max(80, 'Keep label under 80 chars'),
  sortOrder: z
    .number()
    .int('Sort order must be a whole number')
    .min(1, 'Sort order must be at least 1')
    .max(99, 'Sort order must be 99 or less'),
});
type EditLevelFormInput = z.infer<typeof EditLevelFormSchema>;

function EditLevelDialog({
  level,
  open,
  onOpenChange,
}: {
  level: LevelRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const form = useForm<EditLevelFormInput>({
    resolver: zodResolver(EditLevelFormSchema),
    defaultValues: { label: level.label, sortOrder: level.sortOrder },
  });

  // Re-seed whenever the dialog opens (in case another edit changed this
  // row underneath us) or the row's own values move.
  React.useEffect(() => {
    if (open) form.reset({ label: level.label, sortOrder: level.sortOrder });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, level.label, level.sortOrder]);

  const mutation = useMutation({
    mutationFn: (payload: { label?: string; sortOrder: number }) =>
      apiFetch(`/api/sis/admin/levels/${level.id}`, jsonInit('PATCH', payload)),
    onError: (e) => {
      // 422 core_label_locked surfaces verbatim (KD #24) — shouldn't fire
      // in practice since the label field is disabled for core rows, but
      // covers a stale-form edge case.
      toast.error(
        e instanceof Error ? e.message : 'Could not update this level'
      );
    },
  });

  async function onSubmit(values: EditLevelFormInput) {
    try {
      // Core rows never send a label — the route treats an omitted field as
      // "unchanged", so this is a belt-and-suspenders match for the
      // disabled input rather than relying on the value happening to equal
      // the original.
      await mutation.mutateAsync(
        level.isCore
          ? { sortOrder: values.sortOrder }
          : { label: values.label, sortOrder: values.sortOrder }
      );
      toast.success(`Updated ${level.label}`);
      onOpenChange(false);
      router.refresh();
    } catch {
      // onError already surfaced the toast.
    }
  }

  const busy = form.formState.isSubmitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {level.code}</DialogTitle>
          <DialogDescription>
            {level.isCore
              ? 'Position can change; the name is fixed for core levels.'
              : "Update this level's display name or where it sits in the list."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Label</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      disabled={level.isCore}
                      autoCapitalize="words"
                    />
                  </FormControl>
                  {level.isCore ? (
                    <FormDescription>
                      Core level names are fixed — attendance and
                      class-assignment rules key on them.
                    </FormDescription>
                  ) : (
                    <FormMessage />
                  )}
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sortOrder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Position</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      value={field.value}
                      onChange={(e) =>
                        field.onChange(Number(e.target.value) || 0)
                      }
                      className="tabular-nums"
                    />
                  </FormControl>
                  <FormDescription>
                    Where this level sits in display order (1–99).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy} className="gap-1.5">
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Pencil className="size-3.5" />
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

// =====================================================================
// Add level — the page's one primary CTA (rendered via SisPageHeader's
// actions slot), RHF+zod mirror of LevelAdminCreateSchema. Exported and
// dual-mode: uncontrolled with its own trigger button (the header CTA), or
// controlled (`open`/`onOpenChange`, no visible trigger) for SmartSyncPanel
// to drive with a pre-filled label. `nextLevelId` is still sent as `null`
// on every create (the schema requires the key) but has no visible field —
// the "Next level" concept was removed from the UI 2026-07-14.
// =====================================================================

function blankLevelValues(
  sortOrder: number,
  label?: string
): LevelAdminCreateInput {
  return {
    code: '',
    label: label ?? '',
    levelType: 'primary',
    sortOrder,
    nextLevelId: null,
  };
}

export function AddLevelDialog({
  levels,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  initialLabel,
}: {
  levels: LevelRow[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialLabel?: string;
}) {
  const router = useRouter();
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = isControlled
    ? (controlledOnOpenChange ?? (() => {}))
    : setUncontrolledOpen;

  const nextSortOrder = React.useMemo(() => {
    const max = levels.reduce((m, l) => Math.max(m, l.sortOrder), 0);
    return Math.min(99, max + 1);
  }, [levels]);

  const form = useForm<LevelAdminCreateInput>({
    resolver: zodResolver(LevelAdminCreateSchema),
    defaultValues: blankLevelValues(nextSortOrder, initialLabel),
  });

  React.useEffect(() => {
    if (open) form.reset(blankLevelValues(nextSortOrder, initialLabel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nextSortOrder, initialLabel]);

  const createMutation = useMutation({
    mutationFn: (payload: LevelAdminCreateInput) =>
      apiFetch('/api/sis/admin/levels', jsonInit('POST', payload)),
    onError: (e) => {
      // 409 duplicate code surfaces verbatim (KD #24).
      toast.error(
        e instanceof Error ? e.message : 'Could not create this level'
      );
    },
  });

  async function onSubmit(values: LevelAdminCreateInput) {
    try {
      await createMutation.mutateAsync({
        ...values,
        code: values.code.trim().toUpperCase(),
        label: values.label.trim(),
      });
      toast.success(`Added ${values.label} to the level catalog`);
      setOpen(false);
      form.reset(blankLevelValues(nextSortOrder));
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
        if (!next) form.reset(blankLevelValues(nextSortOrder, initialLabel));
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          <Button className="gap-1.5">
            <Plus className="size-3.5" />
            Add level
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a grade level</DialogTitle>
          <DialogDescription>
            New levels start unoffered in every school year — turn one on for a
            specific AY from the list once it&apos;s created.
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
                      placeholder="e.g. CS3"
                      {...field}
                      onChange={(e) =>
                        field.onChange(e.target.value.toUpperCase())
                      }
                      className="uppercase"
                    />
                  </FormControl>
                  <FormDescription>
                    Short internal id — uppercase letters, digits, or hyphens.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Label</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Cambridge Secondary Three"
                      {...field}
                      autoCapitalize="words"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="levelType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {LEVEL_TYPE_VALUES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {LEVEL_TYPE_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Preschool levels have no WW/PT/QA grading profile.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sortOrder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Position</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      value={field.value}
                      onChange={(e) =>
                        field.onChange(Number(e.target.value) || 0)
                      }
                      className="tabular-nums"
                    />
                  </FormControl>
                  <FormDescription>
                    Where this level sits in display order (1–99).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                {busy ? 'Adding…' : 'Add level'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
