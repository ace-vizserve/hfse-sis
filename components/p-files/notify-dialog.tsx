'use client';

import { useMutation } from '@tanstack/react-query';
import { Mail, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, ApiError, jsonInit } from '@/lib/query/fetcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type Recipients = {
  motherEmail: string | null;
  fatherEmail: string | null;
  guardianEmail: string | null;
};

type ResolvedRecipient = {
  email: string;
  role: 'mother' | 'father' | 'guardian';
};

function resolveRecipients(
  slotKey: string,
  recipients: Recipients
): ResolvedRecipient[] {
  const motherEmail = recipients.motherEmail?.trim() || null;
  const fatherEmail = recipients.fatherEmail?.trim() || null;
  const guardianEmail = recipients.guardianEmail?.trim() || null;

  if (slotKey.startsWith('mother')) {
    return motherEmail ? [{ email: motherEmail, role: 'mother' }] : [];
  }
  if (slotKey.startsWith('father')) {
    return fatherEmail ? [{ email: fatherEmail, role: 'father' }] : [];
  }
  if (slotKey.startsWith('guardian')) {
    return guardianEmail ? [{ email: guardianEmail, role: 'guardian' }] : [];
  }
  const out: ResolvedRecipient[] = [];
  if (motherEmail) out.push({ email: motherEmail, role: 'mother' });
  if (fatherEmail) out.push({ email: fatherEmail, role: 'father' });
  if (out.length === 0 && guardianEmail)
    out.push({ email: guardianEmail, role: 'guardian' });
  return out;
}

const ROLE_LABEL: Record<ResolvedRecipient['role'], string> = {
  mother: 'Mother',
  father: 'Father',
  guardian: 'Guardian',
};

type NotifyDialogProps = {
  enroleeNumber: string;
  slotKey: string;
  label: string;
  recipients: Recipients;
  /** ISO timestamp of the most recent reminder, if within cooldown window. */
  lastReminderAt?: string | null;
  trigger?: React.ReactNode;
  /**
   * Discriminator forwarded to the API so the route picks the right
   * audit action + email tone. Defaults to 'p-files' for back-compat
   * with existing renewal-lifecycle callers.
   */
  module?: 'p-files' | 'admissions';
};

export function NotifyDialog({
  enroleeNumber,
  slotKey,
  label,
  recipients,
  lastReminderAt,
  trigger,
  module = 'p-files',
}: NotifyDialogProps) {
  const [open, setOpen] = useState(false);

  const resolved = useMemo(
    () => resolveRecipients(slotKey, recipients),
    [slotKey, recipients]
  );

  const cooldownActive = useMemo(() => {
    if (!lastReminderAt) return false;
    const hours = (Date.now() - new Date(lastReminderAt).getTime()) / 36e5;
    return hours < 24;
  }, [lastReminderAt]);

  type NotifyResult = { sent: number; recipients: number };

  const notifyMutation = useMutation({
    mutationFn: () =>
      apiFetch<NotifyResult>(
        `/api/p-files/${encodeURIComponent(enroleeNumber)}/notify`,
        jsonInit('POST', { slotKey, module })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function handleSend() {
    setBusy(true);
    await run(() => notifyMutation.mutateAsync(), {
      pending: 'Sending reminder…',
      success: (body) =>
        `Reminder sent to ${body.sent} of ${body.recipients} recipient${body.recipients === 1 ? '' : 's'}`,
      // The route's `no_recipients` kind earns a toast with an action, which a
      // plain message can't carry — so it is raised here and `null` returned to
      // stop the helper adding a second, plainer one on top. Everything else
      // falls back to the route's `body.error` (= ApiError.message).
      error: (e) => {
        const kind =
          e instanceof ApiError &&
          e.body &&
          typeof e.body === 'object' &&
          (e.body as { kind?: string }).kind;
        if (kind === 'no_recipients') {
          toast.error(
            'No parent or guardian email on file — update the contact record in Admissions to send a reminder.',
            {
              action: {
                label: 'Open in Admissions',
                onClick: () =>
                  window.open(
                    `/admissions/applications/${encodeURIComponent(enroleeNumber)}?tab=family`,
                    '_blank'
                  ),
              },
            }
          );
          return null;
        }
        return e instanceof Error ? e.message : 'Failed to send reminder';
      },
      onResolved: () => setOpen(false),
    });
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <Mail className="size-3" />
            Notify parent
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md!">
        <DialogHeader>
          <DialogTitle className="font-serif tracking-tight">
            {module === 'admissions'
              ? 'Send chase reminder'
              : 'Send renewal reminder'}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">
            Email the parent / guardian to action <strong>{label}</strong>. The
            full message includes the student name, document, expiry date (if
            any), and a link to the parent portal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Recipients
            </p>
            {resolved.length === 0 ? (
              <p className="rounded-lg border border-destructive/30 bg-gradient-to-b from-destructive/15 to-destructive/5 px-3 py-2 text-[12px] text-destructive">
                No parent or guardian email is on file for this slot. Add one in
                admissions before sending a reminder.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {resolved.map((r) => (
                  <li
                    key={r.email}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[12px]"
                  >
                    <span className="truncate font-mono">{r.email}</span>
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px] uppercase tracking-[0.12em]"
                    >
                      {ROLE_LABEL[r.role]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {cooldownActive && (
            <p className="rounded-md border border-brand-amber/30 bg-brand-amber-light/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              A reminder for this slot was already sent within the last 24
              hours. Sending again will be rejected by the server until the
              cooldown clears.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSend()}
            loading={busy}
            loadingText="Sending…"
            disabled={resolved.length === 0 || cooldownActive}
          >
            {!busy && <Send className="size-4" />}
            Send reminder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
