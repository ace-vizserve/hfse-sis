'use client';

import type { ColumnDef } from '@tanstack/react-table';
import {
  ChevronDown,
  Copy,
  GraduationCap,
  KeyRound,
  Loader2,
  Pencil,
  RefreshCw,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  AssignmentChips,
  StaffAvatar,
  assignmentSummaryText,
  type AssignmentChipAdviser,
  type AssignmentChipSubject,
} from '@/components/sis/staff-visuals';
import {
  StaffAssignmentSheet,
  type StaffSheetTeacher,
} from '@/components/sis/staff-assignment-sheet';
import { Button } from '@/components/ui/button';
import { DataTable, RowActionsMenu } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { Switch } from '@/components/ui/switch';
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ROLES, type Role } from '@/lib/auth/roles';
import { TABLE_COPY } from '@/lib/copy/data-table';
import type { AdminUserRow } from '@/lib/sis/users/queries';

type AssignmentSummary = {
  adviserSections: AssignmentChipAdviser[];
  subjectAssignments: AssignmentChipSubject[];
};

// ─── Role labels ──────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<Role, string> = {
  teacher: 'Teacher',
  academic_coordinator: 'Academic Coordinator',
  school_admin: TABLE_COPY.schoolAdmin,
  superadmin: 'Superadmin',
  p_file_officer: 'P-File Officer',
  admissions: 'Admissions',
};

// ─── Columns ──────────────────────────────────────────────────────────────────

function buildColumns(
  currentUserId: string,
  canManage: boolean,
  assignmentsByUserId: Record<string, AssignmentSummary>,
  onManageAssignments: (teacher: StaffSheetTeacher) => void
): ColumnDef<AdminUserRow>[] {
  return [
    {
      id: 'user',
      accessorFn: (row) => row.display_name,
      header: ({ column }) => (
        <SortableHeader column={column}>User</SortableHeader>
      ),
      meta: { label: 'User' },
      // No identifier link — no canonical user-detail page
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <StaffAvatar name={row.original.display_name} />
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">
              {row.original.display_name}
            </div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {row.original.email}
            </div>
          </div>
        </div>
      ),
      enableHiding: false,
    },
    {
      id: 'role',
      // Sorts and exports on every role the account holds, not just the one it
      // is working under — the column is titled Roles and shows all of them.
      accessorFn: (row) => row.roles.join(', '),
      header: 'Roles',
      meta: { label: 'Roles' },
      cell: ({ row }) => (
        <RolePicker
          user={row.original}
          isSelf={row.original.id === currentUserId}
          canManage={canManage}
        />
      ),
      // Filtering by Teacher finds a school_admin who also teaches. Anything
      // else would hide the very people this column now exists to show.
      filterFn: (row, _id, value) => {
        if (!value || (Array.isArray(value) && value.length === 0)) return true;
        const held: string[] = row.original.roles;
        return Array.isArray(value)
          ? value.some((v: string) => held.includes(v))
          : held.includes(value as string);
      },
    },
    {
      id: 'assignments',
      // Keyed on whether this page HAS teaching data for the row, not on the
      // row's role. Anyone on staff can hold a class now, so `role !==
      // 'teacher'` is no longer a reason to say there is nothing to show.
      //
      // ⚠ IT STILL SHOWS A DASH FOR MOST NON-TEACHER STAFF, AND THAT IS A
      // KNOWN GAP, NOT A CLAIM. `assignmentsByUserId` is built from
      // `loadStaffAssignments`, whose roster is still teacher-only — see the
      // note above `loadStaffAssignmentsUncached` in lib/sis/staff.ts for why
      // widening that roster is a product call nobody has made. A dash means
      // "not shown here"; printing "No assignments" for a school_admin who
      // advises a form class would be a statement, and a false one. When that
      // roster widens, this column follows with no further edit.
      accessorFn: (row) => {
        const a = assignmentsByUserId[row.id];
        if (!a) return '';
        // Already answers 'No assignments' for an empty pair of lists.
        return assignmentSummaryText(a.adviserSections, a.subjectAssignments);
      },
      header: 'Assignments',
      cell: ({ row }) => {
        const a = assignmentsByUserId[row.original.id];
        if (!a) {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        return (
          <AssignmentChips
            adviserSections={a.adviserSections}
            subjectAssignments={a.subjectAssignments}
          />
        );
      },
    },
    {
      id: 'user_status',
      accessorFn: (row) => (row.disabled ? 'Disabled' : 'Active'),
      header: 'Status',
      cell: ({ row }) => (
        <UserStatusToggle
          user={row.original}
          isSelf={row.original.id === currentUserId}
          canManage={canManage}
        />
      ),
      filterFn: (row, _id, value) => {
        if (!value || (Array.isArray(value) && value.length === 0)) return true;
        const statusVal = row.original.disabled ? 'Disabled' : 'Active';
        return Array.isArray(value)
          ? value.includes(statusVal)
          : statusVal === value;
      },
    },
    {
      // created_at: hidden-by-default "Member since" column
      id: 'created_at',
      accessorKey: 'created_at',
      header: ({ column }) => (
        <SortableHeader column={column}>Member since</SortableHeader>
      ),
      meta: { label: 'Member since' },
      cell: ({ row }) => (
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {new Date(row.original.created_at).toLocaleDateString('en-SG', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'lastSignIn',
      accessorKey: 'last_sign_in_at',
      header: ({ column }) => (
        <SortableHeader column={column}>Last sign-in</SortableHeader>
      ),
      meta: { label: 'Last sign-in' },
      // Nulls sort last regardless of direction (never-signed-in rows sink).
      sortingFn: (a, b) => {
        const aVal = a.original.last_sign_in_at;
        const bVal = b.original.last_sign_in_at;
        if (!aVal && !bVal) return 0;
        if (!aVal) return 1; // a has no sign-in → push down
        if (!bVal) return -1; // b has no sign-in → push down
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      },
      cell: ({ row }) => (
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {row.original.last_sign_in_at
            ? new Date(row.original.last_sign_in_at).toLocaleDateString(
                'en-SG',
                {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                }
              )
            : '—'}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RowActionsMenu>
            <EditUserMenuItem
              user={row.original}
              isSelf={row.original.id === currentUserId}
              canManage={canManage}
            />
            {/* Offered on EVERY staff row, not only the ones whose role is
                `teacher`. Anyone on staff can hold a class — six school_admin
                accounts already do in the live year, four of them as the form
                adviser of record — and this row action, which opens the
                assignment sheet for the person in the row, is the one place in
                the app those rows can be maintained.

                ⚠ This reads the ROLE OF THE ROW, the person being listed, not
                the viewer's. It is not a lens site and the lens must not be
                applied to it. Every row on this page is a staff account
                already (`listStaffUsers` filters to real roles), so there is
                no parent to exclude here; the parent check that matters is on
                the write path, in POST /api/teacher-assignments. */}
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onManageAssignments({
                  userId: row.original.id,
                  name: row.original.display_name,
                  email: row.original.email,
                });
              }}
            >
              <GraduationCap className="size-3.5" />
              Manage teaching assignments
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DeleteUserMenuItem
              user={row.original}
              isSelf={row.original.id === currentUserId}
              canManage={canManage}
            />
          </RowActionsMenu>
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
  ];
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// Most people do one job, so the control has to stay quiet for the 38 accounts
// that hold one role while making the second one visible on the six that hold
// two. It keeps the shape and size of the Select it replaces — the column reads
// unchanged at a glance — and adds a count only when there is something to
// count. Ticking a role saves immediately, exactly as picking one did.
function RolePicker({
  user,
  isSelf,
  canManage,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  canManage: boolean;
}) {
  const rolesMutation = useMutation({
    mutationFn: (next: Role[]) =>
      apiFetch(
        `/api/sis/admin/users/${user.id}`,
        jsonInit('PATCH', { role: next })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  const held = user.roles;

  async function toggleRole(role: Role, add: boolean) {
    const next = add ? [...held, role] : held.filter((r) => r !== role);
    // The server refuses an empty list too — this is the half that explains
    // why, before the person loses their click. An account with no role reads
    // as a parent everywhere in the app, so it is a lockout, not a tidy-up.
    if (next.length === 0) return;
    setBusy(true);
    await run(() => rolesMutation.mutateAsync(next), {
      pending: `Updating ${user.email}…`,
      success: add
        ? `${user.email} is now also a ${ROLE_LABEL[role]}`
        : `${ROLE_LABEL[role]} removed from ${user.email}`,
      error: (e: unknown) => (e instanceof Error ? e.message : 'update failed'),
    });
    setBusy(false);
  }

  const disabledReason = !canManage
    ? 'Only superadmins can change staff roles'
    : isSelf
      ? 'You cannot change your own roles here'
      : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy || isSelf || !canManage}
          title={disabledReason ?? held.map((r) => ROLE_LABEL[r]).join(', ')}
          // Mirrors SelectTrigger's treatment — same border, shadow, hover,
          // focus ring and open state — so replacing the Select does not change
          // how the column looks or behaves under the keyboard.
          className="flex h-8 w-[172px] items-center justify-between gap-1 rounded-md border border-hairline bg-background px-3 text-[13px] shadow-input transition-all hover:border-hairline-strong hover:bg-muted/40 focus-visible:border-brand-indigo/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/20 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-60 data-[state=open]:border-brand-indigo/60 data-[state=open]:ring-2 data-[state=open]:ring-brand-indigo/20"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-foreground">
              {held.length > 0 ? ROLE_LABEL[held[0]] : 'No role'}
            </span>
            {held.length > 1 && (
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                +{held.length - 1}
              </span>
            )}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[220px]">
        {ROLES.map((r) => {
          const checked = held.includes(r);
          const isLast = checked && held.length === 1;
          return (
            <DropdownMenuCheckboxItem
              key={r}
              checked={checked}
              disabled={isLast || busy}
              title={
                isLast
                  ? 'Give this account another role before removing this one'
                  : undefined
              }
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(v) => void toggleRole(r, v === true)}
            >
              {ROLE_LABEL[r]}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Inline Status toggle — mirrors the established Switch idiom already used
// for AY-setup's per-row "Accepting applications" toggle
// (ay-accepting-applications-toggle.tsx): Tier-2 mutation (no local
// optimistic value, the Switch reflects the server-provided `disabled`
// prop; a successful flip router.refresh()es to re-read it). Replaces the
// prior overflow-menu-only Enable/Disable action — Role already got an
// inline Select on this same table, so Status gets the same first-class
// treatment instead of staying a click-through-the-menu action.
function UserStatusToggle({
  user,
  isSelf,
  canManage,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  canManage: boolean;
}) {
  const toggleMutation = useMutation({
    mutationFn: (next: boolean) =>
      apiFetch(
        `/api/sis/admin/users/${user.id}`,
        jsonInit('PATCH', { disabled: next })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function toggleDisabled(next: boolean) {
    setBusy(true);
    await run(() => toggleMutation.mutateAsync(next), {
      pending: next ? `Disabling ${user.email}…` : `Enabling ${user.email}…`,
      success: next ? `Disabled: ${user.email}` : `Enabled: ${user.email}`,
      error: (e: unknown) => (e instanceof Error ? e.message : 'update failed'),
    });
    setBusy(false);
  }

  const disabledReason = !canManage
    ? 'Only superadmins can enable or disable accounts'
    : isSelf
      ? 'You cannot disable your own account here'
      : undefined;

  return (
    <div className="flex items-center gap-2" title={disabledReason}>
      <Switch
        checked={!user.disabled}
        disabled={busy || isSelf || !canManage}
        onCheckedChange={(v) => void toggleDisabled(!v)}
        aria-label={`${user.disabled ? 'Enable' : 'Disable'} ${user.email}`}
      />
      <span className="whitespace-nowrap text-[13px] font-medium text-foreground">
        {user.disabled ? 'Disabled' : 'Active'}
      </span>
    </div>
  );
}

// ─── Edit user ────────────────────────────────────────────────────────────────

function EditUserMenuItem({
  user,
  isSelf,
  canManage,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenuItem
        disabled={isSelf || !canManage}
        onSelect={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        title={
          !canManage
            ? 'Only superadmins can edit staff accounts'
            : isSelf
              ? 'Edit your own account at /account'
              : `Edit ${user.display_name}`
        }
      >
        <Pencil className="size-3.5" />
        Edit User
      </DropdownMenuItem>
      <EditUserDialog open={open} onOpenChange={setOpen} user={user} />
    </>
  );
}

function EditUserDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AdminUserRow;
}) {
  const [displayName, setDisplayName] = useState(
    user.display_name === user.email.split('@')[0] ? '' : user.display_name
  );
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');

  function fillPassword() {
    const p = generatePassword();
    setPassword(p);
    void navigator.clipboard?.writeText(p).then(
      () => toast.success('Password generated + copied to clipboard'),
      () => toast.success('Password generated. Copy it before saving.')
    );
  }

  async function copyPassword() {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      toast.success('Password copied');
    } catch {
      toast.error("Couldn't copy — select + copy manually");
    }
  }

  const saveMutation = useMutation({
    mutationFn: (vars: { payload: Record<string, unknown>; email: string }) =>
      apiFetch(
        `/api/sis/admin/users/${user.id}`,
        jsonInit('PATCH', vars.payload)
      ),
  });

  const run = useWriteAction();
  const [saving, setSaving] = useState(false);

  async function commit(vars: {
    payload: Record<string, unknown>;
    email: string;
  }) {
    setSaving(true);
    await run(() => saveMutation.mutateAsync(vars), {
      pending: `Saving ${vars.email}…`,
      success: `Updated: ${vars.email}`,
      error: (e: unknown) => (e instanceof Error ? e.message : 'update failed'),
      onResolved: () => onOpenChange(false),
    });
    setSaving(false);
  }

  function submit() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      toast.error('Valid email required');
      return;
    }
    if (password && password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    const payload: Record<string, unknown> = {};
    const trimmedName = displayName.trim();
    if (trimmedName !== user.display_name) payload.displayName = trimmedName;
    if (trimmedEmail !== user.email) payload.email = trimmedEmail;
    if (password) payload.password = password;

    if (Object.keys(payload).length === 0) {
      toast.message('No changes to save.');
      onOpenChange(false);
      return;
    }

    void commit({ payload, email: trimmedEmail });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (saving) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-xl!">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-lg">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Pencil className="size-4" />
            </div>
            Edit staff user
          </DialogTitle>
          <DialogDescription>
            Changes apply immediately. Share new credentials out-of-band if you
            reset the password.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-email">Email</Label>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Display name</Label>
            <Input
              id="edit-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Jane Smith"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-password">
              <span className="inline-flex items-center gap-1.5">
                <KeyRound className="size-3.5" /> Reset password
              </span>
            </Label>
            <div className="flex gap-1.5">
              <Input
                id="edit-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank to keep current password"
                className="font-mono tabular-nums"
                maxLength={72}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={fillPassword}
                title="Generate strong password + copy"
              >
                <RefreshCw className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={copyPassword}
                disabled={!password}
                title="Copy password"
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Leave blank to keep the current password. Generated passwords
              avoid 0/O/1/l/I.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={saving || !email}>
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Pencil className="size-3.5" />
            )}
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete user ──────────────────────────────────────────────────────────────

function DeleteUserMenuItem({
  user,
  isSelf,
  canManage,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenuItem
        disabled={isSelf || !canManage}
        className="text-destructive focus:text-destructive"
        onSelect={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        title={
          !canManage
            ? 'Only superadmins can delete staff accounts'
            : isSelf
              ? 'You cannot delete your own account'
              : `Delete ${user.display_name}`
        }
      >
        <Trash2 className="size-3.5" />
        Delete
      </DropdownMenuItem>
      <DeleteUserDialog open={open} onOpenChange={setOpen} user={user} />
    </>
  );
}

function DeleteUserDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AdminUserRow;
}) {
  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/sis/admin/users/${user.id}`, jsonInit('DELETE')),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    await run(() => deleteMutation.mutateAsync(), {
      pending: `Deleting ${user.email}…`,
      success: `Deleted: ${user.email}`,
      // The route's has_activity / last-superadmin messages are precise —
      // never flatten them into a generic message (KD #24).
      error: (e: unknown) => (e instanceof Error ? e.message : 'delete failed'),
      onResolved: () => onOpenChange(false),
    });
    setBusy(false);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        onOpenChange(o);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this account?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes <strong>{user.email}</strong>. It only
            succeeds if the account has never done anything the system tracks —
            if it has, you&apos;ll see exactly where, and should use Disable
            instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void remove();
            }}
            disabled={busy}
            variant="destructive"
          >
            {busy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Main client component ───────────────────────────────────────────────────

// Staff account directory — the Accounts cut of /sis/admin/staff (formerly
// the standalone /sis/admin/users page, KD #87 direct-create-only semantics
// unchanged). `canManage` is true for superadmin only — every mutating
// route behind these actions (POST/PATCH /api/sis/admin/users/**) is
// superadmin-gated server-side; school_admin sees the same directory but
// every action renders disabled with a plain-English hint instead of being
// omitted from the table, so the read-only view still shows what exists.
export function StaffAccountsClient({
  users,
  currentUserId,
  canManage,
  ayCode,
  assignmentsByUserId,
}: {
  users: AdminUserRow[];
  currentUserId: string;
  canManage: boolean;
  ayCode: string;
  assignmentsByUserId: Record<string, AssignmentSummary>;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedTeacher, setSelectedTeacher] =
    useState<StaffSheetTeacher | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function handleManageAssignments(teacher: StaffSheetTeacher) {
    setSelectedTeacher(teacher);
    setSheetOpen(true);
  }

  const columns = buildColumns(
    currentUserId,
    canManage,
    assignmentsByUserId,
    handleManageAssignments
  );

  const toolbarTrailing = canManage ? (
    <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
  ) : (
    <p className="font-mono text-[11px] text-muted-foreground">
      Read-only — ask a superadmin to add or edit accounts.
    </p>
  );

  return (
    <>
      <DataTable<AdminUserRow>
        data={users}
        columns={columns}
        getRowId={(row) => row.id}
        searchKeys={['email', 'display_name', (row) => row.roles.join(' ')]}
        searchPlaceholder="Search email, name, or role…"
        statusTabs={[
          {
            value: 'all',
            label: 'All',
            predicate: () => true,
            isDefault: true,
          },
          {
            value: 'active',
            label: 'Active',
            predicate: (r: AdminUserRow) => !r.disabled,
          },
          {
            value: 'disabled',
            label: 'Disabled',
            predicate: (r: AdminUserRow) => Boolean(r.disabled),
          },
        ]}
        facets={[
          {
            columnId: 'role',
            label: 'Roles',
            valueOptions: ROLES.map((r) => r),
          },
        ]}
        toolbarTrailing={toolbarTrailing}
        // Namespaced url-state so filters persist + are shareable; leaves the page's own params untouched (KD #84)
        url={{ enabled: true, namespace: 'users' }}
        initialSort={[{ id: 'user', desc: false }]}
        // "Member since" shown by default now (layout redesign pass) — hiding
        // one of only 6 columns behind the Columns menu on a table this
        // narrow was complexity added, not removed (Tesler's Law/Choice
        // Overload); the menu itself stays for anyone who wants to hide it.
        pageSize={25}
        emptyState={{
          icon: Users,
          title: 'No staff users yet.',
          ...(canManage
            ? {
                cta: {
                  label: 'Invite user',
                  onClick: () => setInviteOpen(true),
                },
              }
            : {
                body: 'Ask a superadmin to add the first staff account.',
              }),
        }}
        emptyFilteredState={{
          title: 'No users match.',
          body: 'Try clearing filters or adjusting the search.',
        }}
      />
      <StaffAssignmentSheet
        teacher={selectedTeacher}
        ayCode={ayCode}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </>
  );
}

// ─── New user dialog ──────────────────────────────────────────────────────────

// Crypto-strong random password generator. 16 chars from a curated set
// excluding visually-confusable glyphs (no 0/O, 1/l/I). Mix of upper +
// lower + digit guaranteed by construction.
function generatePassword(): string {
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const all = upper + lower + digit;
  const buf = new Uint32Array(16);
  crypto.getRandomValues(buf);
  // Guarantee one from each category in the first 3 chars, fill the rest
  // from the full pool. Order doesn't matter — the random fill scrambles.
  const out: string[] = [
    upper[buf[0] % upper.length],
    lower[buf[1] % lower.length],
    digit[buf[2] % digit.length],
  ];
  for (let i = 3; i < buf.length; i++) out.push(all[buf[i] % all.length]);
  // Light shuffle so the category-anchored prefix isn't predictable.
  return out
    .map((ch) => ({ ch, k: Math.random() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.ch)
    .join('');
}

function InviteUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roles, setRoles] = useState<Role[]>(['teacher']);
  const [password, setPassword] = useState('');

  function resetForm() {
    setEmail('');
    setDisplayName('');
    setRoles(['teacher']);
    setPassword('');
  }

  // Kept in ROLES order however they were ticked, so the account's first role —
  // the one it starts working in — doesn't depend on click order.
  function toggleRole(role: Role, add: boolean) {
    setRoles((current) =>
      add
        ? ROLES.filter((r) => r === role || current.includes(r))
        : current.filter((r) => r !== role)
    );
  }

  function fillPassword() {
    const p = generatePassword();
    setPassword(p);
    void navigator.clipboard?.writeText(p).then(
      () => toast.success('Password generated + copied to clipboard'),
      () => toast.success('Password generated. Copy it before submitting.')
    );
  }

  async function copyPassword() {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      toast.success('Password copied');
    } catch {
      toast.error("Couldn't copy — select + copy manually");
    }
  }

  const createMutation = useMutation({
    mutationFn: (vars: { email: string; roles: Role[] }) =>
      apiFetch(
        '/api/sis/admin/users',
        jsonInit('POST', {
          email: vars.email,
          role: vars.roles,
          displayName: displayName.trim() || undefined,
          password,
        })
      ),
  });

  const run = useWriteAction();
  const [saving, setSaving] = useState(false);

  async function submit() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      toast.error('Valid email required');
      return;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (roles.length === 0) {
      toast.error('Pick at least one role');
      return;
    }

    setSaving(true);
    const payload = { email: trimmedEmail, roles };
    await run(() => createMutation.mutateAsync(payload), {
      pending: `Creating the account for ${trimmedEmail}…`,
      // The "account + teacher assignment" job used to span two pages
      // (KD #154 / SIS Admin IA Phase 4). When the new account is a teacher,
      // point straight at the Assignments cut of this same page so the
      // registrar/superadmin can finish the job in one visit. That needs a
      // toast action, which a plain message can't carry — so it is raised here
      // and `null` returned to stop a second, plainer one landing on top.
      success: () => {
        const message = `Account created for ${trimmedEmail}. Share the password securely.`;
        if (roles.includes('teacher')) {
          toast.success(message, {
            action: {
              label: 'Now assign their classes →',
              onClick: () => router.push('/sis/admin/staff'),
            },
          });
          return null;
        }
        return message;
      },
      error: (e: unknown) =>
        e instanceof Error ? e.message : 'user creation failed',
      onResolved: () => {
        onOpenChange(false);
        resetForm();
      },
    });
    setSaving(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !saving) resetForm();
        onOpenChange(o);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <UserPlus className="size-3.5" />
          New user
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl!">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-lg">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <KeyRound className="size-4" />
            </div>
            New staff user
          </DialogTitle>
          <DialogDescription>
            Account is active immediately. Set the password upfront and share it
            with the user out-of-band (Slack, in-person). They can change it
            after first sign-in from{' '}
            <span className="font-mono text-[11px]">/account</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="new.user@hfse.edu.sg"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Display name (optional)</Label>
            <Input
              id="invite-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Jane Smith"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              <span className="inline-flex items-center gap-1.5">
                <Shield className="size-3.5" /> Roles
              </span>
            </Label>
            {/* Laid out flat rather than behind a dropdown: the dialog has the
                room, and seeing all six at once is what makes it obvious a
                second one can be picked. */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-hairline p-3">
              {ROLES.map((r) => (
                <label
                  key={r}
                  className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground"
                >
                  <Checkbox
                    checked={roles.includes(r)}
                    onCheckedChange={(v) => toggleRole(r, v === true)}
                  />
                  {ROLE_LABEL[r]}
                </label>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Most people have one. Pick two if this person does both jobs —
              they choose which one they are working in, and can change it from
              their own account.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-password">
              <span className="inline-flex items-center gap-1.5">
                <KeyRound className="size-3.5" /> Initial password
              </span>
            </Label>
            <div className="flex gap-1.5">
              <Input
                id="invite-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Set a strong password"
                className="font-mono tabular-nums"
                minLength={8}
                maxLength={72}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={fillPassword}
                title="Generate strong password + copy"
              >
                <RefreshCw className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={copyPassword}
                disabled={!password}
                title="Copy current password"
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Minimum 8 characters. Generated passwords avoid 0/O/1/l/I to
              reduce share-out errors.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={
              saving || !email || password.length < 8 || roles.length === 0
            }
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <KeyRound className="size-3.5" />
            )}
            {saving ? 'Creating…' : 'Create account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
