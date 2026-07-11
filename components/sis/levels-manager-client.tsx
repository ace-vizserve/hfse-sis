'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarRange,
  Layers,
  Loader2,
  Plus,
  Trash2,
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
  PROFILE_LABEL,
  ProfileLegendChip,
} from '@/components/sis/weight-profile';

// Grade Levels admin — Levels & Grade Progression, Phase 3 (migration 078).
// One Card of ordered rows (sort_order, already sorted by getLevelRows).
// Each row: code / label / type chip / weight-profile chip / "Next level"
// picker (immediate-save, mirrors the offering Switch's Tier-1 optimistic
// pattern, KD #24) / Core badge OR offered Switch / demand chip / delete.

const LEVEL_TYPE_LABEL: Record<LevelType, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  preschool: 'Preschool',
};

// Sentinel for the "no next level" Select option — Radix disallows an empty
// string SelectItem value (same pattern as SCHEDULE_NONE in
// template-manager-client.tsx).
const NEXT_LEVEL_NONE = '__none__';

type Props = {
  levels: LevelRow[];
  offeredLevelIds: string[];
  demandRows: LevelDemandRow[];
  ayOptions: Array<{ ayCode: string; label: string; isCurrent: boolean }>;
  currentAyCode: string;
  currentAyId: string;
  acceptingAyCode: string | null;
};

export function LevelsManagerClient({
  levels,
  offeredLevelIds,
  demandRows,
  ayOptions,
  currentAyCode,
  currentAyId,
  acceptingAyCode,
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

  const coreCount = levels.filter((l) => l.isCore).length;

  return (
    <div className="space-y-4">
      {/* AY switcher strip — governs which AY's offering Switches the list
          below reads/writes. Demand (below) is scoped separately, to the
          accepting AY, regardless of this selection. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <CalendarRange className="size-3.5" />
          Offerings shown for
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <LevelsAySwitcher current={currentAyCode} options={ayOptions} />
          <AddLevelDialog levels={levels} />
        </div>
      </div>

      <Card className="@container/card gap-0 overflow-hidden py-0">
        <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-4">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Layers className="size-4" />
          </div>
          <div className="leading-tight">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Grade level catalog
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
                levels={levels}
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

      <p className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {currentAyCode || '—'} · {levels.length} level
        {levels.length === 1 ? '' : 's'} · {coreCount} permanent · every change
        is audit-logged
      </p>
    </div>
  );
}

// =====================================================================
// AY switcher — same idiom as SubjectAySwitcher, scoped to this route.
// =====================================================================

function LevelsAySwitcher({
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
      <SelectTrigger className="h-9 w-56">
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
// Row
// =====================================================================

function LevelRowItem({
  level,
  levels,
  offered,
  demand,
  currentAyId,
  currentAyCode,
  acceptingAyCode,
}: {
  level: LevelRow;
  levels: LevelRow[];
  offered: boolean;
  demand: LevelDemandRow | null;
  currentAyId: string;
  currentAyCode: string;
  acceptingAyCode: string | null;
}) {
  const showDemandChip = demand !== null && !demand.offered && demand.count > 0;

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-4">
      <Badge
        variant="outline"
        className="h-6 shrink-0 border-border bg-white px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
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

      <NextLevelSelect level={level} levels={levels} />

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

      <div className="ml-auto flex shrink-0 items-center gap-2">
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
        <DeleteLevelMenu level={level} />
      </div>
    </li>
  );
}

// =====================================================================
// "Next level" picker — Tier-1 optimistic immediate-save (KD #24).
// =====================================================================

function NextLevelSelect({
  level,
  levels,
}: {
  level: LevelRow;
  levels: LevelRow[];
}) {
  const router = useRouter();
  const [value, setValue] = React.useState(
    level.nextLevelId ?? NEXT_LEVEL_NONE
  );

  // Re-seed when the server row changes underneath us (e.g. after a
  // router.refresh() from another row's edit).
  React.useEffect(() => {
    setValue(level.nextLevelId ?? NEXT_LEVEL_NONE);
  }, [level.nextLevelId]);

  const mutation = useMutation({
    mutationFn: (nextLevelId: string | null) =>
      apiFetch(
        `/api/sis/admin/levels/${level.id}`,
        jsonInit('PATCH', { nextLevelId })
      ),
    onError: (e) => {
      // Roll back to the last-known-good server value — the route's
      // plain-English message (progression_cycle / self_reference / FK)
      // surfaces verbatim per KD #24's error-preservation rule.
      setValue(level.nextLevelId ?? NEXT_LEVEL_NONE);
      toast.error(
        e instanceof Error ? e.message : 'Could not update the next level'
      );
    },
    onSuccess: () => {
      toast.success(`Updated ${level.label}'s next level`);
      router.refresh();
    },
  });

  function onChange(next: string) {
    setValue(next); // optimistic
    mutation.mutate(next === NEXT_LEVEL_NONE ? null : next);
  }

  const options = levels.filter((l) => l.id !== level.id);

  return (
    <Select
      value={value}
      onValueChange={onChange}
      disabled={mutation.isPending}
    >
      <SelectTrigger className="h-8 w-60 shrink-0 text-[13px]">
        <SelectValue placeholder="Next level" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NEXT_LEVEL_NONE}>None — final level</SelectItem>
        {options.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            <span className="font-mono text-xs">{l.code}</span>
            <span className="ml-2 text-muted-foreground">{l.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
// Delete — row ⋯ menu → AlertDialog confirm; disabled-with-reason on core.
// =====================================================================

function DeleteLevelMenu({ level }: { level: LevelRow }) {
  const router = useRouter();
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
// Add level — the page's one primary CTA, RHF+zod mirror of
// LevelAdminCreateSchema (the route's actual validator — see the schema's
// own header comment distinguishing it from the pre-existing, differently
// shaped LevelCreateSchema used by the admissions-level-review flow).
// =====================================================================

function blankLevelValues(sortOrder: number): LevelAdminCreateInput {
  return {
    code: '',
    label: '',
    levelType: 'primary',
    sortOrder,
    nextLevelId: null,
  };
}

function AddLevelDialog({ levels }: { levels: LevelRow[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const nextSortOrder = React.useMemo(() => {
    const max = levels.reduce((m, l) => Math.max(m, l.sortOrder), 0);
    return Math.min(99, max + 1);
  }, [levels]);

  const form = useForm<LevelAdminCreateInput>({
    resolver: zodResolver(LevelAdminCreateSchema),
    defaultValues: blankLevelValues(nextSortOrder),
  });

  React.useEffect(() => {
    if (open) form.reset(blankLevelValues(nextSortOrder));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nextSortOrder]);

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
        if (!next) form.reset(blankLevelValues(nextSortOrder));
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-1.5">
          <Plus className="size-3.5" />
          Add level
        </Button>
      </DialogTrigger>
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
            <FormField
              control={form.control}
              name="nextLevelId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Next level</FormLabel>
                  <Select
                    value={field.value ?? NEXT_LEVEL_NONE}
                    onValueChange={(v) =>
                      field.onChange(v === NEXT_LEVEL_NONE ? null : v)
                    }
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NEXT_LEVEL_NONE}>
                        None — final level
                      </SelectItem>
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
                  <FormDescription>
                    What a returning student applies for next. A suggestion only
                    — it never moves anyone automatically.
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
