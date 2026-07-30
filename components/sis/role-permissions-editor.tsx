'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Lock, Minus, Pencil } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { RESOURCES, type Capability } from '@/lib/auth/capabilities';
import type { Role } from '@/lib/auth/roles';
import { ROLE_LABELS } from '@/lib/copy/data-table';

// Two surfaces over one dataset, because a superadmin asks two different
// questions and neither answers the other:
//
//   "What can this role do?"        — read down a column.
//   "Who can validate documents?"   — read across a row.
//
// A per-role dialog answers only the first, so the page is a whole-grid
// overview and editing happens per role in a drawer. Editing one role at a time
// also matches the save: one audit row naming one role, and a last-holder guard
// that can reason about a single change.

type Grant = { role: string; capability: string };

type Props = {
  grants: Grant[];
  /** Every role except superadmin, whose grants are fixed. */
  editableRoles: Role[];
  lockedRole: Role;
};

function actionLabel(action: string): string {
  // Actions are short verbs; the resource carries the noun, so "Read" reads
  // correctly under a "Documents — before enrolment" row.
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
}: Props) {
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
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="min-w-[260px]">
                  What someone can do
                </TableHead>
                {allRoles.map((role) => (
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
                <TableHead className="w-[1%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {RESOURCES.map((resource) => (
                <React.Fragment key={resource.key}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={allRoles.length + 2}
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
                        {allRoles.map((role) => {
                          const on = held.get(role)?.has(capability) ?? false;
                          return (
                            <TableCell key={role} className="text-center">
                              {on ? (
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
                          );
                        })}
                        <TableCell />
                      </TableRow>
                    );
                  })}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {editableRoles.map((role) => (
          <Button
            key={role}
            variant="outline"
            size="sm"
            onClick={() => setEditing(role)}
          >
            <Pencil />
            Edit {ROLE_LABELS[role]}
          </Button>
        ))}
      </div>

      {editing && (
        <EditRoleSheet
          role={editing}
          current={[...(held.get(editing) ?? [])] as Capability[]}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function EditRoleSheet({
  role,
  current,
  onClose,
}: {
  role: Role;
  current: Capability[];
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
      // The route's own message — the last-holder and locked-role refusals both
      // explain what to do instead, and a generic toast would throw that away.
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
            Changes apply the next time someone with this role loads a page.
            They do not need to sign in again.
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
