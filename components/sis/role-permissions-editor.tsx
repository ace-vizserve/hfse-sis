'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Check,
  ChevronDown,
  Lock,
  MoreVertical,
  Minus,
  Pencil,
  Users,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
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
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  ALL_CAPABILITIES,
  RESOURCES,
  type Capability,
  type ResourceKey,
} from '@/lib/auth/capabilities';
import type { Role } from '@/lib/auth/roles';
import { ROLE_LABELS } from '@/lib/copy/data-table';
import { cn } from '@/lib/utils';

// A card per role, because the first question is always "what is this role
// allowed to do, and how many people does that affect" — and a card can answer
// it without reading a grid.
//
// The whole-grid view is kept, collapsed, underneath: it answers the OTHER
// question ("who can approve grade changes?") by reading across a row, which no
// arrangement of per-role cards can. Both are the same data, so neither can go
// stale against the other.

type Grant = { role: string; capability: string };

/**
 * The four areas the cards summarise. Grouped from the eight resources so a
 * card carries four numbers instead of eight — each group is a real part of the
 * school's work, not an arbitrary bucket, and the Edit drawer always shows the
 * resources themselves.
 */
export const AREAS: Array<{ label: string; resources: ResourceKey[] }> = [
  {
    label: 'Documents',
    resources: ['documents_pre_enrolment', 'documents_post_enrolment'],
  },
  {
    label: 'Year & classes',
    resources: ['academic_year', 'school_calendar', 'sections'],
  },
  { label: 'Staff', resources: ['staff', 'approvers'] },
  { label: 'Grades', resources: ['grade_changes'] },
];

function capabilitiesIn(resources: ResourceKey[]): Capability[] {
  return ALL_CAPABILITIES.filter((capability) =>
    resources.some((key) => capability.startsWith(`${key}.`))
  );
}

function actionLabel(action: string): string {
  // Short verbs — the resource heading above carries the noun, so "See" reads
  // correctly under "Documents — before enrolment".
  const words: Record<string, string> = {
    read: 'See',
    edit: 'Change',
    create: 'Add',
    delete: 'Delete',
    validate: 'Approve or reject',
    chase: 'Send reminders',
    upload: 'Upload files',
    approve: 'Approve',
    edit_terms: 'Change terms',
    view_accounts: 'See accounts',
    manage_accounts: 'Manage accounts',
    edit_assignments: 'Assign classes',
    disable: 'Disable',
    manage: 'Manage',
  };
  return words[action] ?? action.replace(/_/g, ' ');
}

export function RolePermissionsEditor({
  grants,
  editableRoles,
  lockedRole,
  peopleByRole,
}: {
  grants: Grant[];
  /** Every role except the locked one. */
  editableRoles: Role[];
  lockedRole: Role;
  /** Active accounts per role — makes an edit's reach concrete. */
  peopleByRole: Record<string, number>;
}) {
  const [editing, setEditing] = React.useState<Role | null>(null);

  const held = React.useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const g of grants) {
      const set = map.get(g.role) ?? new Set<string>();
      set.add(g.capability);
      map.set(g.role, set);
    }
    return map;
  }, [grants]);

  const allRoles: Role[] = [...editableRoles, lockedRole];

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {allRoles.map((role) => (
          <RoleCard
            key={role}
            role={role}
            held={held.get(role) ?? new Set()}
            people={peopleByRole[role] ?? 0}
            locked={role === lockedRole}
            onEdit={() => setEditing(role)}
          />
        ))}
      </div>

      <CompareAllRoles roles={allRoles} held={held} lockedRole={lockedRole} />

      {editing && (
        <EditRoleSheet
          role={editing}
          current={[...(held.get(editing) ?? [])] as Capability[]}
          people={peopleByRole[editing] ?? 0}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function RoleCard({
  role,
  held,
  people,
  locked,
  onEdit,
}: {
  role: Role;
  held: Set<string>;
  people: number;
  locked: boolean;
  onEdit: () => void;
}) {
  const total = ALL_CAPABILITIES.filter((c) => held.has(c)).length;

  return (
    <Card className="gap-0 p-0">
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate font-serif text-lg font-semibold text-foreground">
              {ROLE_LABELS[role]}
            </h2>
            {locked && (
              <Lock
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label="Permissions cannot be changed"
              />
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {people === 1 ? '1 person' : `${people} people`}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={`Actions for ${ROLE_LABELS[role]}`}
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {locked ? (
              <DropdownMenuItem disabled>
                <Lock />
                Can&apos;t be changed
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onEdit()}>
                <Pencil />
                Edit permissions
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href="/sis/admin/staff?view=accounts">
                <Users />
                See who holds this role
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-stretch gap-px rounded-lg bg-muted/40 mx-5 mb-5 overflow-hidden">
        {AREAS.map((area) => {
          const inArea = capabilitiesIn(area.resources);
          const on = inArea.filter((c) => held.has(c)).length;
          return (
            <div
              key={area.label}
              className="flex-1 bg-card/60 px-2.5 py-2.5 text-center"
            >
              <p
                className={cn(
                  'font-serif text-lg font-semibold leading-none tabular-nums',
                  on === 0 ? 'text-muted-foreground/50' : 'text-foreground'
                )}
              >
                {on}
              </p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                {area.label}
              </p>
            </div>
          );
        })}
        {/* Total carries the denominator: a bare "9" under two different areas
            hides whether that is all of them or a third of them. */}
        <div className="flex-1 border-l border-border bg-card/60 px-2.5 py-2.5 text-center">
          <p className="font-serif text-lg font-semibold leading-none tabular-nums text-foreground">
            {total}
            <span className="text-sm text-muted-foreground">
              /{ALL_CAPABILITIES.length}
            </span>
          </p>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            Total
          </p>
        </div>
      </div>
    </Card>
  );
}

function CompareAllRoles({
  roles,
  held,
  lockedRole,
}: {
  roles: Role[];
  held: Map<string, Set<string>>;
  lockedRole: Role;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="group">
          <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
          Compare all roles
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3">
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="min-w-60">
                    What someone can do
                  </TableHead>
                  {roles.map((role) => (
                    <TableHead key={role} className="text-center">
                      <span className="whitespace-nowrap">
                        {ROLE_LABELS[role]}
                      </span>
                      {role === lockedRole && (
                        <Lock
                          className="ml-1 inline size-3 text-muted-foreground"
                          aria-label="Cannot be changed"
                        />
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {RESOURCES.map((resource) => (
                  <React.Fragment key={resource.key}>
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={roles.length + 1}
                        className="bg-muted/20 py-2"
                      >
                        <span className="font-serif text-[15px] font-semibold text-foreground">
                          {resource.label}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {resource.description}
                        </span>
                      </TableCell>
                    </TableRow>
                    {resource.actions.map((action) => {
                      const capability =
                        `${resource.key}.${action}` as Capability;
                      return (
                        <TableRow key={capability}>
                          <TableCell className="pl-6 text-sm text-foreground">
                            {actionLabel(action)}
                          </TableCell>
                          {roles.map((role) => (
                            <TableCell key={role} className="text-center">
                              {held.get(role)?.has(capability) ? (
                                <Check
                                  className="mx-auto size-4 text-brand-mint"
                                  aria-label="Allowed"
                                />
                              ) : (
                                <Minus
                                  className="mx-auto size-3 text-muted-foreground/40"
                                  aria-label="Not allowed"
                                />
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      );
                    })}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

function EditRoleSheet({
  role,
  current,
  people,
  onClose,
}: {
  role: Role;
  current: Capability[];
  people: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(current)
  );

  const dirty =
    selected.size !== current.length || current.some((c) => !selected.has(c));

  const save = useMutation({
    mutationFn: () =>
      apiFetch(
        '/api/sis/admin/role-permissions',
        jsonInit('PATCH', { role, capabilities: [...selected] })
      ),
    onSuccess: () => {
      toast.success(`${ROLE_LABELS[role]} permissions saved.`);
      router.refresh();
      onClose();
    },
    onError: (e) => {
      // The route's own message — the last-holder and locked-role refusals each
      // say what to do instead, and a generic toast would throw that away.
      toast.error(
        e instanceof Error ? e.message : 'Could not save the permissions.'
      );
    },
  });

  function toggle(capability: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(capability);
      else next.delete(capability);
      return next;
    });
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="font-serif">
            What {ROLE_LABELS[role]} can do
          </SheetTitle>
          <SheetDescription>
            {people === 1 ? 'Affects 1 person. ' : `Affects ${people} people. `}
            Changes apply the next time they load a page — they do not need to
            sign in again.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4">
          {RESOURCES.map((resource) => {
            const capabilities = resource.actions.map(
              (a) => `${resource.key}.${a}`
            );
            const allOn = capabilities.every((c) => selected.has(c));
            return (
              <section key={resource.key} className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-serif text-[15px] font-semibold text-foreground">
                      {resource.label}
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {resource.description}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const c of capabilities) {
                          if (allOn) next.delete(c);
                          else next.add(c);
                        }
                        return next;
                      })
                    }
                  >
                    {allOn ? 'Clear all' : 'Allow all'}
                  </Button>
                </div>
                <div className="space-y-2 rounded-lg border border-border p-3">
                  {resource.actions.map((action) => {
                    const capability = `${resource.key}.${action}`;
                    const id = `cap-${capability}`;
                    return (
                      <div
                        key={capability}
                        className="flex items-center gap-2.5"
                      >
                        <Checkbox
                          id={id}
                          checked={selected.has(capability)}
                          onCheckedChange={(v) =>
                            toggle(capability, v === true)
                          }
                        />
                        <label
                          htmlFor={id}
                          className="cursor-pointer text-sm text-foreground"
                        >
                          {actionLabel(action)}
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <SheetFooter className="border-t border-border">
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {dirty ? (
                <Badge variant="warning">Unsaved changes</Badge>
              ) : (
                'No changes yet'
              )}
            </span>
            <div className="flex items-center gap-2">
              <SheetClose asChild>
                <Button variant="outline" type="button">
                  Cancel
                </Button>
              </SheetClose>
              <Button
                type="button"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Saving…' : 'Save permissions'}
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
