"use client";

import { Loader2, Send, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type BulkNotifyItem = {
  enroleeNumber: string;
  studentName: string;
  slotKey: string;
  slotLabel: string;
};

type BulkNotifyDialogProps = {
  items: BulkNotifyItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful (or partial) send to clear the parent's selection. */
  onSuccess?: () => void;
};

export function BulkNotifyDialog({ items, open, onOpenChange, onSuccess }: BulkNotifyDialogProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSend() {
    if (items.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/p-files/notify/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({ enroleeNumber: i.enroleeNumber, slotKey: i.slotKey })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Bulk reminder failed");
        return;
      }
      const skipped =
        (body.skippedCooldown ?? 0) +
        (body.skippedNoRecipients ?? 0) +
        (body.skippedNotEnrolled ?? 0) +
        (body.skippedNotActionable ?? 0);
      const summary = `${body.sent} email${body.sent === 1 ? "" : "s"} sent across ${body.requested} item${body.requested === 1 ? "" : "s"}${
        skipped > 0 ? ` · ${skipped} skipped` : ""
      }`;
      toast.success(summary);
      onSuccess?.();
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk reminder failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg!">
        <DialogHeader>
          <DialogTitle className="font-serif tracking-tight">Send bulk reminders</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">
            Email the parent / guardian for each selected slot. Items already reminded within 24
            hours, students without parent emails, and pre-enrolment rows are silently skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-border/60 bg-background">
          {items.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No items selected.</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {items.map((item) => (
                <li
                  key={`${item.enroleeNumber}:${item.slotKey}`}
                  className="flex items-start justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {item.studentName}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      {item.enroleeNumber}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {item.slotLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <Users className="mr-1 inline size-3" />
          {items.length} item{items.length === 1 ? "" : "s"} queued
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={busy || items.length === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send {items.length} reminder{items.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
