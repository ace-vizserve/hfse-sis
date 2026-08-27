'use client';

import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ListOrdered,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';

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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { apiFetch } from '@/lib/query/fetcher';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import {
  APPROVAL_RESOLVERS,
  APPROVAL_RESOLVER_DESCRIPTIONS,
  APPROVAL_RESOLVER_LABELS,
  APPROVAL_STAGE_LABEL_MAX,
  APPROVER_LEVEL_SCOPE_ANY_LABEL,
  APPROVER_LEVEL_SCOPE_LABELS,
  STAGED_FLOW_DESCRIPTIONS,
  STAGED_FLOW_LABELS,
  type ApprovalResolver,
  type ApproverLevelScope,
} from '@/lib/schemas/approval-flows';
// ⚠ From `readiness.ts`, NOT `config.ts`. `config.ts` is `server-only`, so a
// VALUE imported from it into a client component throws at runtime — and
// TypeScript does not catch it, because a type-only import is erased while a
// function import is not.
import {
  classifyStagedFlowReadiness,
  type FlowConfig,
} from '@/lib/approvals/readiness';
import { cn } from '@/lib/utils';

// Ordered approval flows — the steps, in order, and who is on each.
//
// ── PURPOSE (design-system §5, step 1) ─────────────────────────────────────
// A superadmin sets out who approves what, in what order. The primary action
// is adding a step.
//
// ── PATTERN ────────────────────────────────────────────────────────────────
// The §8 "group container card": a header, a muted meta strip, then a divided
// list. Chosen because a flow IS a group of ordered things, and this is the
// shape the codebase already uses for exactly that.
//
// ⚠ NUMBERING IS THE CONTENT HERE, not ornament. Everything about this screen
// is the fact that step 1 happens before step 2 — that is the whole reason
// these tables exist, and the difference between this and the pooled approver
// table above it.
//
// ⚠ NO `default` BUTTON. The page already has one, on the approver table
// above (§9.2: exactly one primary CTA per view), and every control here is
// configuration, which §9.2 assigns to `outline`.

type StaffOption = {
  userId: string;
  email: string;
  displayName: string;
  role: string | null;
};

// ── The half-of-the-school tag ─────────────────────────────────────────────
//
// ⚠ NOT a §9.3 status badge, and that is deliberate. Those three recipes read
// severity — mint is healthy, destructive is blocked. "Primary" is neither: it
// is a fact about the job, not a state of it. Giving Primary and Secondary two
// different colours would also be colour as decoration (§9: colour carries
// meaning, never decoration), because neither half is more urgent than the
// other. So the WORDS carry it, in the mono micro-copy voice §7.1 reserves for
// exactly this kind of metadata, and the only colour difference is between
// "limited to one half" and "everybody".
function ScopeTag({ scope }: { scope: ApproverLevelScope | null }) {
  return (
    <span
      className={
        'font-mono text-[10px] font-semibold tracking-[0.12em] uppercase ' +
        (scope ? 'text-brand-indigo-deep' : 'text-muted-foreground')
      }
    >
      {scope
        ? APPROVER_LEVEL_SCOPE_LABELS[scope].replace(' only', '')
        : APPROVER_LEVEL_SCOPE_ANY_LABEL}
    </span>
  );
}

export function StagedFlowEditor({
  flows,
  staff,
  levelTypesInUse = [],
}: {
  flows: FlowConfig[];
  staff: StaffOption[];
  /**
   * The halves of the school that actually have classes this year. Drives the
   * options offered when adding somebody, so a school with no preschool is
   * never asked about preschool.
   */
  levelTypesInUse?: ApproverLevelScope[];
}) {
  if (flows.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="space-y-1.5">
        <p className="font-mono text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Step-by-step approvals
        </p>
        <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Approvals that happen in order
        </h2>
        <p className="max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
          These run one step at a time. A request goes to the first step, and
          only moves to the next once somebody there has approved it. Any one
          person on a step can approve for that step. If anyone turns it down,
          it stops there and the parent is told.
        </p>
      </div>

      {flows.map((flow) => (
        <FlowCard
          key={flow.flow}
          flow={flow}
          staff={staff}
          levelTypesInUse={levelTypesInUse}
        />
      ))}
    </section>
  );
}

function FlowCard({
  flow,
  staff,
  levelTypesInUse,
}: {
  flow: FlowConfig;
  staff: StaffOption[];
  levelTypesInUse: ApproverLevelScope[];
}) {
  const readiness = classifyStagedFlowReadiness(flow.stages, levelTypesInUse);
  const [addingStep, setAddingStep] = useState(false);

  return (
    <Card className="@container/card gap-0 py-0">
      <CardHeader className="border-b border-border py-5">
        <CardDescription className="font-mono text-[10px] font-semibold tracking-[0.14em] uppercase">
          Approval flow
        </CardDescription>
        <CardTitle className="font-serif text-[22px]">
          {STAGED_FLOW_LABELS[flow.flow]}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <ListOrdered className="size-4" />
          </div>
        </CardAction>
      </CardHeader>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-muted/30 px-6 py-3">
        {/* §9.3 recipes — mint when it can finish, destructive when it cannot. */}
        <Badge
          className={cn(
            'h-6',
            readiness.tone === 'mint'
              ? 'border-brand-mint bg-brand-mint/30 text-ink'
              : 'border-destructive/40 bg-destructive/10 text-destructive'
          )}
        >
          {readiness.label}
        </Badge>
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          {readiness.warning ?? STAGED_FLOW_DESCRIPTIONS[flow.flow]}
        </p>
      </div>

      {flow.stages.length === 0 ? (
        <div className="px-6 py-8 text-center">
          <p className="font-serif text-base font-semibold text-foreground">
            No steps yet
          </p>
          <p className="mx-auto mt-1 max-w-md text-[14px] leading-relaxed text-muted-foreground">
            Add the first step to start. For absence declarations the school
            asked for the child&rsquo;s form class adviser, then an officer in
            charge.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {flow.stages.map((stage, index) => (
            <StageRow
              key={stage.id}
              stage={stage}
              position={index + 1}
              isFirst={index === 0}
              isLast={index === flow.stages.length - 1}
              staff={staff}
              levelTypesInUse={levelTypesInUse}
            />
          ))}
        </ul>
      )}

      <div className="border-t border-border px-6 py-4">
        <Button variant="outline" size="sm" onClick={() => setAddingStep(true)}>
          <Plus className="size-3.5" />
          Add a step
        </Button>
      </div>

      <AddStageDialog
        flow={flow.flow}
        open={addingStep}
        onOpenChange={setAddingStep}
      />
    </Card>
  );
}

function StageRow({
  stage,
  position,
  isFirst,
  isLast,
  staff,
  levelTypesInUse,
}: {
  stage: FlowConfig['stages'][number];
  position: number;
  isFirst: boolean;
  isLast: boolean;
  staff: StaffOption[];
  levelTypesInUse: ApproverLevelScope[];
}) {
  const run = useWriteAction();
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(stage.label);
  const [retiring, setRetiring] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosen, setChosen] = useState<StaffOption | null>(null);
  const [busy, setBusy] = useState(false);

  const isNamed = stage.resolver === 'named';

  // Halves each person already holds on this step. `null` in the list means
  // "every child", which leaves nothing further to give them.
  const heldByUser = new Map<string, Array<ApproverLevelScope | null>>();
  for (const a of stage.approvers) {
    const list = heldByUser.get(a.userId) ?? [];
    list.push(a.appliesToLevelType);
    heldByUser.set(a.userId, list);
  }

  // ⚠ Somebody already on the step is NOT filtered out, unless they already
  // cover every child. The officer in charge is one post per half, so a person
  // holding Primary can legitimately be asked to cover Secondary too — and the
  // old "exclude anyone already here" rule made that impossible to configure.
  const candidates = staff.filter(
    (s) => !(heldByUser.get(s.userId) ?? []).includes(null)
  );

  // Only offer halves the school actually runs, and only ones this person does
  // not already hold. `null` (every child) is always offered.
  const scopeOptions: Array<ApproverLevelScope | null> = chosen
    ? [
        null,
        ...levelTypesInUse.filter(
          (t) => !(heldByUser.get(chosen.userId) ?? []).includes(t)
        ),
      ]
    : [];

  // Tags appear on every chip of a step as soon as ONE person is limited to a
  // half. On a step where nobody is scoped — every other flow in the system —
  // the chips stay exactly as they were. Within a step that does use scoping,
  // labelling all of them stops an untagged name reading as "not set up yet".
  const anyScoped = stage.approvers.some((a) => a.appliesToLevelType !== null);

  function closePicker() {
    setPickerOpen(false);
    setChosen(null);
  }

  async function patch(body: Record<string, unknown>, pending: string) {
    setBusy(true);
    await run(
      () =>
        apiFetch<{ message?: string }>(
          `/api/sis/admin/approval-stages/${stage.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        ),
      { pending, success: (data) => data.message ?? 'Saved.' }
    );
    setBusy(false);
  }

  return (
    <li className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-start sm:gap-4">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent font-mono text-[11px] font-semibold text-accent-foreground tabular-nums">
        {position}
      </span>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="space-y-0.5">
          <p className="text-[15px] font-medium text-foreground">
            {stage.label}
          </p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {APPROVAL_RESOLVER_DESCRIPTIONS[stage.resolver]}
          </p>
        </div>

        {isNamed && (
          <div className="flex flex-wrap items-center gap-1.5">
            {stage.approvers.map((approver) => (
              <span
                key={approver.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 py-1 pr-1 pl-2.5 text-[13px] text-foreground"
              >
                {approver.displayName}
                {anyScoped && <ScopeTag scope={approver.appliesToLevelType} />}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  aria-label={
                    approver.appliesToLevelType
                      ? `Remove ${approver.displayName} from ${stage.label} for ${APPROVER_LEVEL_SCOPE_LABELS[approver.appliesToLevelType].replace(' only', '')}`
                      : `Remove ${approver.displayName} from ${stage.label}`
                  }
                  onClick={async () => {
                    setBusy(true);
                    await run(
                      () =>
                        apiFetch(
                          `/api/sis/admin/approval-stage-approvers/${approver.id}`,
                          { method: 'DELETE' }
                        ),
                      {
                        pending: 'Removing…',
                        success: `${approver.displayName} is no longer on this step.`,
                      }
                    );
                    setBusy(false);
                  }}
                >
                  <X className="size-3" />
                </Button>
              </span>
            ))}

            {stage.approvers.length === 0 && (
              <span className="text-[13px] text-destructive">
                Nobody yet — nothing can get past this step.
              </span>
            )}

            {/* Two steps, both inside the popover. Choosing a person is a
                search; choosing the half is a single question with three
                answers — that stays inline rather than opening a dialog over
                a popover, which would nest two layers of overlay for one
                field. */}
            <Popover
              open={pickerOpen}
              onOpenChange={(next) =>
                next ? setPickerOpen(true) : closePicker()
              }
            >
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy}>
                  <UserPlus className="size-3.5" />
                  Add someone
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="start">
                {chosen === null ? (
                  <Command>
                    <CommandInput placeholder="Search staff" />
                    <CommandList>
                      <CommandEmpty>
                        Nobody left to add. Everyone with a staff account
                        already approves for every child on this step.
                      </CommandEmpty>
                      {candidates.map((person) => (
                        <CommandItem
                          key={person.userId}
                          value={`${person.displayName} ${person.email}`}
                          onSelect={() => setChosen(person)}
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-[14px] text-foreground">
                              {person.displayName}
                            </span>
                            <span className="truncate font-mono text-[11px] text-muted-foreground">
                              {person.email}
                            </span>
                          </span>
                        </CommandItem>
                      ))}
                    </CommandList>
                  </Command>
                ) : (
                  <ScopeStep
                    person={chosen}
                    stage={stage}
                    options={scopeOptions}
                    busy={busy}
                    onBack={() => setChosen(null)}
                    onAdd={async (scope) => {
                      setBusy(true);
                      await run(
                        () =>
                          apiFetch('/api/sis/admin/approval-stage-approvers', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              stage_id: stage.id,
                              user_id: chosen.userId,
                              applies_to_level_type: scope,
                            }),
                          }),
                        {
                          pending: 'Adding…',
                          success: scope
                            ? `${chosen.displayName} can now approve this step for ${APPROVER_LEVEL_SCOPE_LABELS[scope].replace(' only', '').toLowerCase()} children.`
                            : `${chosen.displayName} can now approve this step for every child.`,
                          onResolved: closePicker,
                        }
                      );
                      setBusy(false);
                    }}
                  />
                )}
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Move ${stage.label} earlier`}
          disabled={isFirst || busy}
          onClick={() => patch({ move: 'up' }, 'Moving…')}
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Move ${stage.label} later`}
          disabled={isLast || busy}
          onClick={() => patch({ move: 'down' }, 'Moving…')}
        >
          <ArrowDown className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Rename ${stage.label}`}
          disabled={busy}
          onClick={() => {
            setLabel(stage.label);
            setRenaming(true);
          }}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-destructive hover:text-destructive"
          aria-label={`Remove ${stage.label}`}
          disabled={busy}
          onClick={() => setRetiring(true)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Rename this step</DialogTitle>
            <DialogDescription>
              This is the name people see on the request, so make it the job,
              not the person.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`label-${stage.id}`}>Step name</FieldLabel>
            <Input
              id={`label-${stage.id}`}
              value={label}
              maxLength={APPROVAL_STAGE_LABEL_MAX}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={!label.trim() || label.trim() === stage.label}
              loading={busy}
              loadingText="Saving…"
              onClick={async () => {
                await patch({ label: label.trim() }, 'Saving…');
                setRenaming(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={retiring} onOpenChange={setRetiring}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">
              Remove &ldquo;{stage.label}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              New requests will skip this step from now on. Requests already
              part-way through keep it, so nothing in flight changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setBusy(true);
                await run(
                  () =>
                    apiFetch(`/api/sis/admin/approval-stages/${stage.id}`, {
                      method: 'DELETE',
                    }),
                  {
                    pending: 'Removing…',
                    success: `“${stage.label}” has been removed from this flow.`,
                  }
                );
                setBusy(false);
              }}
            >
              Remove the step
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

// Step two of the picker: which children this person approves for.
//
// ⚠ THE ACCESS SENTENCE IS NOT A NICETY. Being named to a step is itself how
// somebody gets to read a child's medical certificate — the officer in charge
// sits on a plain teacher account and the declaration's own read rules admit
// neither them nor their role. That grant happens here, at this click, and it
// should not be something a superadmin discovers afterwards.
function ScopeStep({
  person,
  stage,
  options,
  busy,
  onBack,
  onAdd,
}: {
  person: StaffOption;
  stage: FlowConfig['stages'][number];
  options: Array<ApproverLevelScope | null>;
  busy: boolean;
  onBack: () => void;
  onAdd: (scope: ApproverLevelScope | null) => void | Promise<void>;
}) {
  const [scope, setScope] = useState<string>('any');

  const describe = (option: ApproverLevelScope | null): string => {
    if (!option) return 'They can approve for any child in the school.';
    const half = APPROVER_LEVEL_SCOPE_LABELS[option]
      .replace(' only', '')
      .toLowerCase();
    return `They only see filings for children in ${half} classes. Anyone else's go to whoever covers that half.`;
  };

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[14px] font-medium text-foreground">
            {person.displayName}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="-mt-1 -mr-2 h-7 text-[12px]"
            onClick={onBack}
          >
            Change
          </Button>
        </div>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {person.email}
        </p>
      </div>

      <Field>
        <FieldLabel>Which children can they approve for?</FieldLabel>
        <RadioGroup value={scope} onValueChange={setScope} className="gap-2">
          {options.map((option) => {
            const value = option ?? 'any';
            return (
              <label
                key={value}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-2.5 has-[:checked]:border-brand-indigo-soft has-[:checked]:bg-accent"
              >
                <RadioGroupItem value={value} className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block text-[13px] font-medium text-foreground">
                    {option
                      ? APPROVER_LEVEL_SCOPE_LABELS[option]
                      : APPROVER_LEVEL_SCOPE_ANY_LABEL}
                  </span>
                  <span className="block text-[12px] leading-relaxed text-muted-foreground">
                    {describe(option)}
                  </span>
                </span>
              </label>
            );
          })}
        </RadioGroup>
        <FieldDescription>
          Anyone on “{stage.label}” can open what the parent sent, including a
          medical certificate.
        </FieldDescription>
      </Field>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        loading={busy}
        loadingText="Adding…"
        onClick={() =>
          onAdd(scope === 'any' ? null : (scope as ApproverLevelScope))
        }
      >
        Add to this step
      </Button>
    </div>
  );
}

function AddStageDialog({
  flow,
  open,
  onOpenChange,
}: {
  flow: FlowConfig['flow'];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const run = useWriteAction();
  const [label, setLabel] = useState('');
  const [resolver, setResolver] = useState<ApprovalResolver>('named');
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setLabel('');
          setResolver('named');
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Add a step</DialogTitle>
          <DialogDescription>
            It goes on the end. Use the arrows afterwards to move it earlier.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="new-stage-label">Step name</FieldLabel>
          <Input
            id="new-stage-label"
            value={label}
            maxLength={APPROVAL_STAGE_LABEL_MAX}
            placeholder="Officer in charge"
            onChange={(e) => setLabel(e.target.value)}
          />
          <FieldDescription>
            Name the job, not the person — it stays right when the person
            changes.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Who approves this step</FieldLabel>
          <RadioGroup
            value={resolver}
            onValueChange={(v) => setResolver(v as ApprovalResolver)}
            className="gap-3"
          >
            {APPROVAL_RESOLVERS.map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-brand-indigo-soft has-[:checked]:bg-accent"
              >
                <RadioGroupItem value={option} className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block text-[14px] font-medium text-foreground">
                    {APPROVAL_RESOLVER_LABELS[option]}
                  </span>
                  <span className="block text-[13px] leading-relaxed text-muted-foreground">
                    {APPROVAL_RESOLVER_DESCRIPTIONS[option]}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </Field>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={!label.trim()}
            loading={busy}
            loadingText="Adding…"
            onClick={async () => {
              setBusy(true);
              await run(
                () =>
                  apiFetch('/api/sis/admin/approval-stages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      flow,
                      label: label.trim(),
                      resolver,
                    }),
                  }),
                {
                  pending: 'Adding…',
                  success: `“${label.trim()}” has been added to this flow.`,
                  onResolved: () => onOpenChange(false),
                }
              );
              setBusy(false);
            }}
          >
            Add the step
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
