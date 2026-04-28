"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type Props = {
  assignmentId: string;
  email: string;
  flowLabel: string;
};

export function ApproverRevokeButton({ assignmentId, email, flowLabel }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onConfirm(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sis/admin/approvers/${assignmentId}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to revoke approver");
      toast.success(`${email} removed from ${flowLabel}`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="destructive">
          <Trash2 className="mr-1 size-3" />
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {email} as an approver?</AlertDialogTitle>
          <AlertDialogDescription>
            They&apos;ll stop receiving new requests for {flowLabel} and won&apos;t see new ones in their inbox. Pending
            requests that already designated them as primary or secondary stay in their inbox until resolved —
            revocation only affects future teacher submissions.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={submitting}
            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive">
            {submitting && <Loader2 className="mr-1 size-4 animate-spin" />}
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
