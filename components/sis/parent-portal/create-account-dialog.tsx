'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CircleCheck, Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
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
import { useWriteAction } from '@/lib/hooks/use-write-action';
import type {
  CreatedAccount,
  ExistingAccount,
} from '@/lib/parent-portal/accounts';
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  CreateParentAccountFormSchema,
  RELATIONSHIP_LABEL,
  RELATIONSHIPS,
  type CreateParentAccountFormInput,
  type CreateParentAccountInput,
} from '@/lib/schemas/parent-portal';

const BLANK = {
  firstName: '',
  lastName: '',
  relationship: undefined,
  email: '',
  password: '',
  confirmPassword: '',
} as unknown as CreateParentAccountFormInput;

// Singapore time named outright, as in the Parent accounts table.
function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Singapore',
  });
}

function existingFrom(err: unknown): ExistingAccount | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as { existing?: ExistingAccount } | null;
  return body?.existing ?? null;
}

function ExistingAccountPanel({ existing }: { existing: ExistingAccount }) {
  const relationship =
    RELATIONSHIP_LABEL[existing.relationship] ?? existing.relationship;
  return (
    <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
        <TriangleAlert className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-serif text-base font-semibold text-foreground">
          {existing.isStaff
            ? 'This email belongs to a staff account'
            : 'An account with this email already exists'}
        </p>
        <p className="text-sm text-foreground">
          {existing.fullName || 'No name on the account'}
          {relationship ? `, ${relationship.toLowerCase()}` : ''}
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {existing.email}
        </p>
        <p className="text-sm text-muted-foreground">
          {existing.emailConfirmed
            ? 'Email confirmed.'
            : 'Email not confirmed.'}{' '}
          Created {formatDate(existing.createdAt)}. Last sign-in{' '}
          {formatDate(existing.lastSignInAt)}.
        </p>
        <p className="text-sm text-muted-foreground">
          {existing.isStaff
            ? 'No parent account was created. Use a different email for the parent.'
            : 'No new account was created. If the parent has lost access, close this and use Reset password on their row.'}
        </p>
      </div>
    </div>
  );
}

function CreatedAccountPanel({ created }: { created: CreatedAccount }) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-brand-mint bg-brand-mint/10 p-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-mint text-ink shadow-brand-tile">
        <CircleCheck className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-serif text-base font-semibold text-foreground">
          Account created
        </p>
        <p className="text-sm text-foreground">
          {created.fullName},{' '}
          {RELATIONSHIP_LABEL[created.relationship]?.toLowerCase()}
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {created.email}
        </p>
        <p className="text-sm text-muted-foreground">
          The parent can sign in now, and will be asked to change the password
          after they do.
        </p>
      </div>
    </div>
  );
}

/** The caller remounts this per opening, so each one starts blank. */
export function CreateAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [existing, setExisting] = useState<ExistingAccount | null>(null);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [showPasswords, setShowPasswords] = useState(false);

  const form = useForm<CreateParentAccountFormInput>({
    resolver: zodResolver(CreateParentAccountFormSchema),
    defaultValues: BLANK,
  });

  const run = useWriteAction();
  const mutation = useMutation({
    mutationFn: (values: CreateParentAccountInput) =>
      apiFetch<{ ok: true; account: CreatedAccount }>(
        '/api/sis/admin/parent-portal/accounts',
        jsonInit('POST', values)
      ),
  });

  // `confirmPassword` stops here: it is the form's check, not the server's.
  async function onSubmit({
    confirmPassword: _confirm,
    ...values
  }: CreateParentAccountFormInput) {
    setExisting(null);
    await run(() => mutation.mutateAsync(values), {
      pending: 'Creating the account…',
      success: {
        title: 'Parent account created',
        description:
          'Share the password with the parent. They will be asked to change it after they sign in.',
      },
      error: (err) => {
        const found = existingFrom(err);
        if (found) {
          // The panel says it, with the account's details.
          setExisting(found);
          return null;
        }
        return err instanceof Error
          ? err.message
          : 'Could not create the account.';
      },
      onResolved: ({ account }) => setCreated(account),
      // The refresh is what puts the new account in the table behind the dialog.
    });
  }

  const submitting = form.formState.isSubmitting;
  const passwordType = showPasswords ? 'text' : 'password';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            Create account
          </DialogTitle>
          <DialogDescription>
            Sets up an enrolment portal login on a parent&apos;s behalf. It
            works straight away, with no email to confirm, and the parent is
            asked to change the password after they sign in.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <>
            <CreatedAccountPanel created={created} />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Close
                </Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              noValidate
              className="space-y-5"
            >
              <div className="grid items-start gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First name</FormLabel>
                      <FormControl>
                        <Input {...field} autoComplete="off" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last name</FormLabel>
                      <FormControl>
                        <Input {...field} autoComplete="off" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid items-start gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="relationship"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Relationship to the student</FormLabel>
                      <Select
                        value={field.value ?? ''}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Choose one" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {RELATIONSHIPS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {RELATIONSHIP_LABEL[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input {...field} type="email" autoComplete="off" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid items-start gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type={passwordType}
                          autoComplete="new-password"
                          className="font-mono"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm password</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type={passwordType}
                          autoComplete="new-password"
                          className="font-mono"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={showPasswords}
                onClick={() => setShowPasswords((s) => !s)}
              >
                {showPasswords ? <EyeOff /> : <Eye />}
                {showPasswords ? 'Hide passwords' : 'Show passwords'}
              </Button>

              {existing && <ExistingAccountPanel existing={existing} />}

              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={submitting}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  type="submit"
                  loading={submitting}
                  loadingText="Creating…"
                >
                  Create account
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
