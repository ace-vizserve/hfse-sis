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
  STAGED_FLOW_DESCRIPTIONS,
  STAGED_FLOW_LABELS,
  type ApprovalResolver,
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

export function StagedFlowEditor({
  flows,
  staff,
}: {
  flows: FlowConfig[];
  staff: StaffOption[];
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
        <FlowCard key={flow.flow} flow={flow} staff={staff} />
      ))}
    </section>
  );
}

function FlowCard({ flow, staff }: { flow: FlowConfig; staff: StaffOption[] }) {
  const readiness = classifyStagedFlowReadiness(flow.stages);
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
}: {
  stage: FlowConfig['stages'][number];
  position: number;
  isFirst: boolean;
  isLast: boolean;
  staff: StaffOption[];
}) {
  const run = useWriteAction();
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(stage.label);
  const [retiring, setRetiring] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const isNamed = stage.resolver === 'named';
  const taken = new Set(stage.approvers.map((a) => a.userId));
  const candidates = staff.filter((s) => !taken.has(s.userId));

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
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  aria-label={`Remove ${approver.displayName} from ${stage.label}`}
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

            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy}>
                  <UserPlus className="size-3.5" />
                  Add someone
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search staff" />
                  <CommandList>
                    <CommandEmpty>
                      Nobody left to add. Everyone with a staff account is
                      already on this step.
                    </CommandEmpty>
                    {candidates.map((person) => (
                      <CommandItem
                        key={person.userId}
                        value={`${person.displayName} ${person.email}`}
                        onSelect={async () => {
                          setPickerOpen(false);
                          setBusy(true);
                          await run(
                            () =>
                              apiFetch(
                                '/api/sis/admin/approval-stage-approvers',
                                {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                  },
                                  body: JSON.stringify({
                                    stage_id: stage.id,
                                    user_id: person.userId,
                                  }),
                                }
                              ),
                            {
                              pending: 'Adding…',
                              success: `${person.displayName} can now approve this step.`,
                            }
                          );
                          setBusy(false);
                        }}
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
