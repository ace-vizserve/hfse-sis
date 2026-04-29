"use client";

import { Loader2, Mail, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Recipients = {
  motherEmail: string | null;
  fatherEmail: string | null;
  guardianEmail: string | null;
};

type ResolvedRecipient = { email: string; role: "mother" | "father" | "guardian" };

function resolveRecipients(slotKey: string, recipients: Recipients): ResolvedRecipient[] {
  const motherEmail = recipients.motherEmail?.trim() || null;
  const fatherEmail = recipients.fatherEmail?.trim() || null;
  const guardianEmail = recipients.guardianEmail?.trim() || null;

  if (slotKey.startsWith("mother")) {
    return motherEmail ? [{ email: motherEmail, role: "mother" }] : [];
  }
  if (slotKey.startsWith("father")) {
    return fatherEmail ? [{ email: fatherEmail, role: "father" }] : [];
  }
  if (slotKey.startsWith("guardian")) {
    return guardianEmail ? [{ email: guardianEmail, role: "guardian" }] : [];
  }
  const out: ResolvedRecipient[] = [];
  if (motherEmail) out.push({ email: motherEmail, role: "mother" });
  if (fatherEmail) out.push({ email: fatherEmail, role: "father" });
  if (out.length === 0 && guardianEmail) out.push({ email: guardianEmail, role: "guardian" });
  return out;
}

const ROLE_LABEL: Record<ResolvedRecipient["role"], string> = {
  mother: "Mother",
  father: "Father",
  guardian: "Guardian",
};

type NotifyDialogProps = {
  enroleeNumber: string;
  slotKey: string;
  label: string;
  recipients: Recipients;
  /** ISO timestamp of the most recent reminder, if within cooldown window. */
  lastReminderAt?: string | null;
  trigger?: React.ReactNode;
};

export function NotifyDialog({
  enroleeNumber,
  slotKey,
  label,
  recipients,
  lastReminderAt,
  trigger,
}: NotifyDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const resolved = useMemo(() => resolveRecipients(slotKey, recipients), [slotKey, recipients]);

  const cooldownActive = useMemo(() => {
    if (!lastReminderAt) return false;
    const hours = (Date.now() - new Date(lastReminderAt).getTime()) / 36e5;
    return hours < 24;
  }, [lastReminderAt]);

  async function handleSend() {
    setBusy(true);
    try {
      const res = await fetch(`/api/p-files/${encodeURIComponent(enroleeNumber)}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotKey }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to send reminder");
        return;
      }
      toast.success(
        `Reminder sent to ${body.sent} of ${body.recipients} recipient${body.recipients === 1 ? "" : "s"}`,
      );
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send reminder");
    } finally {
      setBusy(false);
    }
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
          <DialogTitle className="font-serif tracking-tight">Send renewal reminder</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">
            Email the parent / guardian to action <strong>{label}</strong>. The full message includes
            the student name, document, expiry date (if any), and a link to the parent portal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Recipients
            </p>
            {resolved.length === 0 ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                No parent or guardian email is on file for this slot. Add one in admissions before
                sending a reminder.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {resolved.map((r) => (
                  <li
                    key={r.email}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[12px]"
                  >
                    <span className="truncate font-mono">{r.email}</span>
                    <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.12em]">
                      {ROLE_LABEL[r.role]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {cooldownActive && (
            <p className="rounded-md border border-brand-amber/30 bg-brand-amber-light/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              A reminder for this slot was already sent within the last 24 hours. Sending again will
              be rejected by the server until the cooldown clears.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={busy || resolved.length === 0 || cooldownActive}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send reminder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
