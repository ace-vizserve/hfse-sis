"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Check, Loader2, X, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  ayCode: string;
  enroleeNumber: string;
  slotKey: string;
  label: string;
  /** Raw status string from the DB (e.g. "Valid", "Rejected", "Uploaded", null) */
  status: string | null;
  /** Effective file URL — no file means nothing to validate */
  url: string | null;
};

// Local schema — the route-side DocumentValidationSchema is a discriminated
// union; here we only need the Reject reason validated client-side.
const RejectFormSchema = z.object({
  rejectionReason: z
    .string()
    .trim()
    .min(20, "Please explain in at least 20 characters")
    .max(2000, "Keep this under 2000 characters"),
});

type RejectFormInput = z.infer<typeof RejectFormSchema>;

function normalize(raw: string | null): string {
  return (raw ?? "").trim().toLowerCase();
}

export function DocumentValidationActions({ ayCode, enroleeNumber, slotKey, label, status, url }: Props) {
  const router = useRouter();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  const form = useForm<RejectFormInput>({
    resolver: zodResolver(RejectFormSchema),
    defaultValues: { rejectionReason: "" },
  });

  // No file → nothing to validate. Parent hasn't uploaded yet.
  if (!url) return null;

  const s = normalize(status);
  const isValid = s === "valid";
  const isRejected = s === "rejected";
  const isExpired = s === "expired";

  // Expired documents need a parent re-upload (KD #60) — manual approval
  // would resurrect a stale doc and bypass the re-upload signal. Hide
  // both buttons and surface a small advisory note. The server gate in
  // /api/sis/students/[enroleeNumber]/document/[slotKey] enforces the
  // same rule with a 422 if anyone calls the API directly.
  if (isExpired) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <AlertCircle className="size-3 text-destructive" />
        Awaiting re-upload
      </span>
    );
  }

  async function send(body: Record<string, unknown>, successMsg: string) {
    const res = await fetch(
      `/api/sis/students/${encodeURIComponent(enroleeNumber)}/document/${encodeURIComponent(slotKey)}?ay=${encodeURIComponent(ayCode)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? successMsg + " failed");
  }

  async function handleApprove() {
    setApproving(true);
    try {
      await send({ status: "Valid" }, "Approve");
      toast.success(`${label} approved`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setApproving(false);
    }
  }

  async function handleReject(values: RejectFormInput) {
    try {
      await send({ status: "Rejected", rejectionReason: values.rejectionReason }, "Reject");
      toast.success(`${label} rejected`);
      setRejectOpen(false);
      form.reset({ rejectionReason: "" });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reject failed");
    }
  }

  const busy = form.formState.isSubmitting;

  return (
    <>
      {!isValid && (
        <Button variant={"success"} disabled={approving} onClick={handleApprove}>
          {approving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          Approve
        </Button>
      )}
      {!isRejected && (
        <Button variant="destructive" onClick={() => setRejectOpen(true)}>
          <X className="size-3" />
          Reject
        </Button>
      )}

      <Dialog
        open={rejectOpen}
        onOpenChange={(next) => {
          setRejectOpen(next);
          if (!next) form.reset({ rejectionReason: "" });
        }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
                <XCircle className="size-4" />
              </div>
              <div className="space-y-1.5 text-left">
                <DialogTitle className="font-serif text-lg font-semibold">Reject {label}</DialogTitle>
                <DialogDescription>
                  Tell the parent what&apos;s wrong so they can re-upload. Minimum 20 characters.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleReject)} className="space-y-4">
              <FormField
                control={form.control}
                name="rejectionReason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason for rejection</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={5}
                        placeholder="e.g. Photo is blurry and the name is cut off at the top edge. Please re-upload a clearer scan."
                        maxLength={2000}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setRejectOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" variant="destructive" disabled={busy}>
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
                  {busy ? "Rejecting…" : "Reject document"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
