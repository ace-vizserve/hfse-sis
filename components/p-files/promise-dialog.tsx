"use client";

import { CalendarClock, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_HORIZON_DAYS = 14;
const MAX_HORIZON_DAYS = 90;

function isoDateOffset(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type PromiseDialogProps = {
  enroleeNumber: string;
  slotKey: string;
  label: string;
  trigger?: React.ReactNode;
};

export function PromiseDialog({ enroleeNumber, slotKey, label, trigger }: PromiseDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [promisedUntil, setPromisedUntil] = useState<string>(isoDateOffset(DEFAULT_HORIZON_DAYS));
  const [note, setNote] = useState("");

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setPromisedUntil(isoDateOffset(DEFAULT_HORIZON_DAYS));
      setNote("");
    }
  }

  async function handleSubmit() {
    if (!promisedUntil) {
      toast.error("Pick a promise date");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/p-files/${encodeURIComponent(enroleeNumber)}/promise`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotKey, promisedUntil, note: note.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to record promise");
        return;
      }
      toast.success(`Promise recorded — slot marked as 'To follow' through ${promisedUntil}`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record promise");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <CalendarClock className="size-3" />
            Mark as promised
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md!">
        <DialogHeader>
          <DialogTitle className="font-serif tracking-tight">Mark as promised</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">
            Record that the parent has committed to re-uploading <strong>{label}</strong>. The slot
            will be marked as <strong>To follow</strong> until the promised date — it surfaces in
            the dashboard&apos;s &quot;promised&quot; bucket so you can re-check on the day.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="promisedUntil" className="mb-1.5 block text-xs font-semibold">
              Promised by
            </Label>
            <DatePicker
              id="promisedUntil"
              value={promisedUntil}
              onChange={setPromisedUntil}
              placeholder="Pick a date"
              allowClear={false}
            />
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Default: {DEFAULT_HORIZON_DAYS} days from today · Max horizon {MAX_HORIZON_DAYS} days
            </p>
          </div>
          <div>
            <Label htmlFor="promiseNote" className="mb-1.5 block text-xs font-semibold">
              Note (optional)
            </Label>
            <Textarea
              id="promiseNote"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Mother confirmed via WhatsApp she's renewing the passport this week"
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={busy || !promisedUntil}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
            Record promise
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
