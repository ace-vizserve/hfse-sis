'use client';

import type { ColumnDef } from '@tanstack/react-table';
import {
  Ban,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  RefreshCw,
  Shield,
  UserPlus,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { StaffAvatar } from '@/components/sis/staff-visuals';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROLES, type Role } from '@/lib/auth/roles';
import { TABLE_COPY } from '@/lib/copy/data-table';
import type { AdminUserRow } from '@/lib/sis/users/queries';

// ─── Role labels ──────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<Role, string> = {
  teacher: 'Teacher',
  academic_coordinator: 'Registrar',
  school_admin: TABLE_COPY.schoolAdmin,
  superadmin: 'Superadmin',
  p_file_officer: 'P-Files',
  admissions: 'Admissions',
};

// ─── Columns ──────────────────────────────────────────────────────────────────

function buildColumns(
  currentUserId: string,
  canManage: boolean
): ColumnDef<AdminUserRow>[] {
  return [
    {
      id: 'user',
      accessorFn: (row) => row.display_name,
      header: ({ column }) => (
        <SortableHeader column={column}>User</SortableHeader>
      ),
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
      accessorFn: (row) => row.role ?? '',
      header: 'Role',
      cell: ({ row }) => (
        <RoleSelect
          user={row.original}
          isSelf={row.original.id === currentUserId}
          canManage={canManage}
        />
      ),
      filterFn: (row, _id, value) => {
        if (!value || (Array.isArray(value) && value.length === 0)) return true;
        const roleVal = row.original.role ?? '';
        return Array.isArray(value)
          ? value.includes(roleVal)
          : roleVal === value;
      },
    },
    {
      id: 'user_status',
      accessorFn: (row) => (row.disabled ? 'Disabled' : 'Active'),
      header: 'Status',
      cell: ({ row }) =>
        row.original.disabled ? (
          <Badge variant="blocked">
            <Ban className="size-3" /> Disabled
          </Badge>
        ) : (
          <Badge variant="success">
            <CheckCircle2 className="size-3" /> Active
          </Badge>
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
        <div className="flex items-center justify-end gap-2">
          {canManage && (
            <EditUserButton
              user={row.original}
              isSelf={row.original.id === currentUserId}
            />
          )}
          <ToggleDisabledButton
            user={row.original}
            isSelf={row.original.id === currentUserId}
            canManage={canManage}
          />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
  ];
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function RoleSelect({
  user,
  isSelf,
  canManage,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  canManage: boolean;
}) {
  const router = useRouter();

  const roleMutation = useMutation({
    mutationFn: (next: Role) =>
      apiFetch(
        `/api/sis/admin/users/${user.id}`,
        jsonInit('PATCH', { role: next })
      ),
    onSuccess: (_data, next) => {
      toast.success(`Role updated: ${user.email} → ${ROLE_LABEL[next]}`);
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'update failed');
    },
  });
  const busy = roleMutation.isPending;

  function setRole(next: Role) {
    if (next === user.role) return;
    roleMutation.mutate(next);
  }

  return (
    <Select
      value={user.role ?? undefined}
      onValueChange={(v) => setRole(v as Role)}
      disabled={busy || isSelf || !canManage}
    >
      <SelectTrigger
        className="h-8 w-[160px]"
        title={
          !canManage
            ? 'Only superadmins can change staff roles'
            : isSelf
              ? 'You cannot change your own role here'
              : undefined
        }
      >
        <SelectValue placeholder="— no role —" />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {ROLE_LABEL[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ToggleDisabledButton({
  user,
  isSelf,
  canManage,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  canManage: boolean;
}) {
  const router = useRouter();

  const toggleMutation = useMutation({
    mutationFn: (next: boolean) =>
      apiFetch(
        `/api/sis/admin/users/${user.id}`,
        jsonInit('PATCH', { disabled: next })
      ),
    onSuccess: (_data, next) => {
      toast.success(
        next ? `Disabled: ${user.email}` : `Enabled: ${user.email}`
      );
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'update failed');
    },
  });
  const busy = toggleMutation.isPending;

  function toggleDisabled() {
    toggleMutation.mutate(!user.disabled);
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={user.disabled ? 'default' : 'destructive'}
      disabled={busy || isSelf || !canManage}
      onClick={toggleDisabled}
      className="gap-1.5"
      title={
        !canManage
          ? 'Only superadmins can enable or disable accounts'
          : isSelf
            ? 'You cannot disable your own account here'
            : undefined
      }
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : user.disabled ? (
        <CheckCircle2 className="size-3.5" />
      ) : (
        <Ban className="size-3.5" />
      )}
      {user.disabled ? 'Enable' : 'Disable'}
    </Button>
  );
}

// ─── Edit user ────────────────────────────────────────────────────────────────

function EditUserButton({
  user,
  isSelf,
}: {
  user: AdminUserRow;
  isSelf: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isSelf}
        onClick={() => setOpen(true)}
        className="gap-1.5"
        title={
          isSelf
            ? 'Edit your own account at /account'
            : `Edit ${user.display_name}`
        }
      >
        <Pencil className="size-3.5" />
        Edit
      </Button>
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
  const router = useRouter();
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
    onSuccess: (_data, vars) => {
      toast.success(`Updated: ${vars.email}`);
      onOpenChange(false);
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'update failed');
    },
  });
  const saving = saveMutation.isPending;

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

    saveMutation.mutate({ payload, email: trimmedEmail });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !saving) onOpenChange(false);
        else onOpenChange(o);
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
}: {
  users: AdminUserRow[];
  currentUserId: string;
  canManage: boolean;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);

  const columns = buildColumns(currentUserId, canManage);

  const toolbarTrailing = canManage ? (
    <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
  ) : (
    <p className="font-mono text-[11px] text-muted-foreground">
      Read-only — ask a superadmin to add or edit accounts.
    </p>
  );

  return (
    <DataTable<AdminUserRow>
      data={users}
      columns={columns}
      getRowId={(row) => row.id}
      searchKeys={['email', 'display_name', (row) => row.role ?? '']}
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
          label: 'Role',
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
  const [role, setRole] = useState<Role>('teacher');
  const [password, setPassword] = useState('');

  function resetForm() {
    setEmail('');
    setDisplayName('');
    setRole('teacher');
    setPassword('');
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
    mutationFn: (vars: { email: string; role: Role }) =>
      apiFetch(
        '/api/sis/admin/users',
        jsonInit('POST', {
          email: vars.email,
          role: vars.role,
          displayName: displayName.trim() || undefined,
          password,
        })
      ),
    onSuccess: (_data, vars) => {
      // The "account + teacher assignment" job used to span two pages
      // (KD #154 / SIS Admin IA Phase 4). When the new account is a
      // teacher, point straight at the Assignments cut of this same page
      // so the registrar/superadmin can finish the job in one visit.
      if (vars.role === 'teacher') {
        toast.success(
          `Account created for ${vars.email}. Share the password securely.`,
          {
            action: {
              label: 'Now assign their classes →',
              onClick: () => router.push('/sis/admin/staff'),
            },
          }
        );
      } else {
        toast.success(
          `Account created for ${vars.email}. Share the password securely.`
        );
      }
      onOpenChange(false);
      resetForm();
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'user creation failed');
    },
  });
  const saving = createMutation.isPending;

  function submit() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      toast.error('Valid email required');
      return;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    createMutation.mutate({ email: trimmedEmail, role });
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
                <Shield className="size-3.5" /> Role
              </span>
            </Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            disabled={saving || !email || password.length < 8}
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
