'use client';

import { useMutation } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Check,
  Copy,
  KeyRound,
  LockKeyhole,
  MailCheck,
  RefreshCw,
  UserPlus,
  UserX,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { HubStat } from '@/components/sis/hub-stat';
import { CreateAccountDialog } from '@/components/sis/parent-portal/create-account-dialog';
import { PortalCardHeader } from '@/components/sis/parent-portal/portal-card-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import {
  generateTemporaryPassword,
  type ParentAccount,
} from '@/lib/parent-portal/accounts';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  RELATIONSHIP_LABEL,
  ResetParentPasswordSchema,
} from '@/lib/schemas/parent-portal';

// Singapore time named outright: the server and the browser must print the same
// date, or the page fails to hydrate around midnight.
function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Singapore',
  });
}

function relationshipLabel(value: string): string {
  return RELATIONSHIP_LABEL[value] ?? value;
}

function buildColumns(
  canAct: boolean,
  onReset: (account: ParentAccount) => void
): ColumnDef<ParentAccount>[] {
  const columns: ColumnDef<ParentAccount>[] = [
    {
      id: 'fullName',
      accessorKey: 'fullName',
      header: ({ column }) => (
        <SortableHeader column={column}>Name</SortableHeader>
      ),
      meta: { label: 'Name' },
      enableHiding: false,
      cell: ({ row }) =>
        row.original.fullName ? (
          <span className="font-medium text-foreground">
            {row.original.fullName}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'email',
      accessorKey: 'email',
      header: ({ column }) => (
        <SortableHeader column={column}>Email</SortableHeader>
      ),
      meta: { label: 'Email' },
      cell: ({ row }) => (
        <span className="font-mono text-[11px] text-muted-foreground">
          {row.original.email}
        </span>
      ),
    },
    {
      id: 'relationship',
      accessorFn: (row) => relationshipLabel(row.relationship),
      header: ({ column }) => (
        <SortableHeader column={column}>Relationship</SortableHeader>
      ),
      meta: { label: 'Relationship' },
      cell: ({ row }) =>
        row.original.relationship ? (
          relationshipLabel(row.original.relationship)
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'emailConfirmed',
      accessorFn: (row) => (row.emailConfirmed ? 'Confirmed' : 'Not confirmed'),
      header: ({ column }) => (
        <SortableHeader column={column}>Email confirmed</SortableHeader>
      ),
      meta: { label: 'Email confirmed' },
      cell: ({ row }) =>
        row.original.emailConfirmed ? (
          <Badge
            variant="outline"
            className="h-6 border-brand-mint bg-brand-mint/30 text-ink"
          >
            Confirmed
          </Badge>
        ) : (
          <Badge variant="secondary" className="h-6">
            Not confirmed
          </Badge>
        ),
    },
    {
      id: 'lastSignInAt',
      accessorFn: (row) => row.lastSignInAt ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Last sign-in</SortableHeader>
      ),
      meta: { label: 'Last sign-in' },
      cell: ({ row }) => (
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatDate(row.original.lastSignInAt)}
        </span>
      ),
    },
  ];

  // Viewers get the list and nothing to press. The route refuses them anyway.
  if (canAct) {
    columns.push({
      id: 'actions',
      header: '',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!row.original.email}
            onClick={() => onReset(row.original)}
          >
            <KeyRound />
            Reset password
          </Button>
        </div>
      ),
    });
  }

  return columns;
}

function ResetPasswordSheet({
  account,
  open,
  onOpenChange,
}: {
  account: ParentAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState(() => generateTemporaryPassword());
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const run = useWriteAction();
  const mutation = useMutation({
    mutationFn: (values: { email: string; password: string }) =>
      apiFetch(
        '/api/sis/admin/parent-portal/accounts/password',
        jsonInit('POST', values)
      ),
  });

  const parsed = ResetParentPasswordSchema.shape.password.safeParse(password);
  const passwordError = parsed.success ? null : parsed.error.issues[0]?.message;
  const name = account.fullName || account.email;

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(
        'Could not copy the password. Select it and copy it by hand.'
      );
    }
  }

  async function commit() {
    setSaving(true);
    await run(() => mutation.mutateAsync({ email: account.email, password }), {
      pending: `Resetting the password for ${name}…`,
      success: {
        title: 'Password reset',
        description: `Share it with ${name}. They will be asked to change it after they sign in.`,
      },
      onResolved: () => onOpenChange(false),
      // Nothing on this page shows the password, so there is nothing to reload.
      refresh: false,
    });
    setSaving(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-lg"
      >
        <SheetHeader className="gap-1.5 border-b border-border p-5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Parent Portal
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            Reset password
          </SheetTitle>
          <SheetDescription>
            For {name}
            {account.fullName ? ` (${account.email})` : ''}. Their old password
            stops working straight away.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <FieldGroup>
            <Field data-invalid={!!passwordError}>
              <FieldLabel htmlFor="parent-reset-password">
                Temporary password
              </FieldLabel>
              <Input
                id="parent-reset-password"
                type="text"
                autoComplete="off"
                spellCheck={false}
                className="font-mono tabular-nums"
                aria-invalid={!!passwordError}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setCopied(false);
                }}
              />
              <FieldDescription>
                {passwordError ??
                  'Use this one or type your own, at least 8 characters.'}
              </FieldDescription>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPassword(generateTemporaryPassword());
                    setCopied(false);
                  }}
                >
                  <RefreshCw />
                  Regenerate
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!password}
                  onClick={() => void copyPassword()}
                >
                  {copied ? <Check /> : <Copy />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </Field>
          </FieldGroup>
          <p className="mt-4 text-sm text-muted-foreground">
            {name} will only be able to sign in with the new password. Copy it
            first: it is not shown again after this.
          </p>
        </div>

        <SheetFooter className="gap-2 border-t border-border p-5">
          <SheetClose asChild>
            <Button type="button" variant="outline" disabled={saving}>
              Cancel
            </Button>
          </SheetClose>
          <Button
            type="button"
            disabled={!!passwordError}
            loading={saving}
            loadingText="Resetting…"
            onClick={() => void commit()}
          >
            Reset password
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function AccountsTab({
  accounts,
  canAct,
}: {
  accounts: ParentAccount[];
  canAct: boolean;
}) {
  // `opened` remounts the Sheet per opening, so each one starts with a fresh
  // password. The account stays set while the Sheet animates closed.
  const [target, setTarget] = useState<ParentAccount | null>(null);
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(0);
  // The same for the dialog, so each opening starts blank.
  const [creating, setCreating] = useState(false);
  const [createOpenings, setCreateOpenings] = useState(0);

  const columns = useMemo(
    () =>
      buildColumns(canAct, (account) => {
        setTarget(account);
        setOpened((n) => n + 1);
        setOpen(true);
      }),
    [canAct]
  );

  const confirmed = accounts.filter((a) => a.emailConfirmed).length;
  const neverSignedIn = accounts.filter((a) => !a.lastSignInAt).length;

  return (
    // `contain`: the table scrolls inside its card rather than widening the page.
    <div className="space-y-5" style={{ contain: 'inline-size' }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <HubStat
          label="Parent accounts"
          value={accounts.length}
          icon={Users}
          tone="brand"
          subtext="Logins for the enrolment portal"
          emphasize
        />
        <HubStat
          label="Email confirmed"
          value={confirmed}
          icon={MailCheck}
          tone="mint"
          subtext="Can sign in"
        />
        <HubStat
          label="Never signed in"
          value={neverSignedIn}
          icon={UserX}
          tone={neverSignedIn > 0 ? 'amber' : 'muted'}
          subtext="No sign-in on record"
        />
      </div>
      <Card>
        <PortalCardHeader
          eyebrow={`${accounts.length} parent account${accounts.length === 1 ? '' : 's'}${canAct ? '' : ' · Read-only for your role'}`}
          title="Accounts"
          icon={LockKeyhole}
          action={
            canAct ? (
              <Button
                type="button"
                onClick={() => {
                  setCreateOpenings((n) => n + 1);
                  setCreating(true);
                }}
              >
                <UserPlus />
                Create account
              </Button>
            ) : undefined
          }
        />
        <CardContent>
          <DataTable<ParentAccount>
            data={accounts}
            columns={columns}
            getRowId={(row) => row.id}
            searchKeys={['fullName', 'email']}
            searchPlaceholder="Search name or email…"
            url={{ enabled: true, namespace: 'parents' }}
            initialSort={[{ id: 'fullName', desc: false }]}
            pageSize={25}
            emptyState={{
              icon: Users,
              title: 'No parent accounts yet.',
              body: 'Accounts appear here once a parent signs up on the portal or one is created here.',
            }}
            emptyFilteredState={{
              title: 'No accounts match.',
              body: 'Try another name or email.',
            }}
          />
        </CardContent>
      </Card>
      {canAct && target && (
        <ResetPasswordSheet
          key={opened}
          account={target}
          open={open}
          onOpenChange={setOpen}
        />
      )}
      {canAct && createOpenings > 0 && (
        <CreateAccountDialog
          key={createOpenings}
          open={creating}
          onOpenChange={setCreating}
        />
      )}
    </div>
  );
}
