"use client";

import { Loader2, UserPlus } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ApproverFlow } from "@/lib/schemas/approvers";

type Candidate = { user_id: string; email: string; role: string };

type Props = {
  flow: ApproverFlow;
  flowLabel: string;
  candidates: Candidate[];
};

export function ApproverAssignDialog({ flow, flowLabel, candidates }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    if (!userId) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/sis/admin/approvers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, flow }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to assign approver");
      if (body.alreadyAssigned) {
        toast.info("User is already assigned to this flow");
      } else {
        toast.success("Approver assigned");
      }
      setOpen(false);
      setUserId("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign approver");
    } finally {
      setSubmitting(false);
    }
  }

  const noCandidates = candidates.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setUserId("");
          setSubmitting(false);
        }
      }}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={noCandidates}>
          <UserPlus className="mr-1 size-3.5" />
          Add approver
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add approver to {flowLabel}</DialogTitle>
          <DialogDescription>
            Assigned users will see change requests from teachers in their admin inbox and receive the notification
            email when a new request is filed.
          </DialogDescription>
        </DialogHeader>
        {noCandidates ? (
          <p className="text-sm text-muted-foreground">Every admin and superadmin is already assigned to this flow.</p>
        ) : (
          <div className="space-y-2">
            <Label className="text-xs font-medium">User</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a user…" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.user_id} value={c.user_id}>
                    {c.email}
                    <span className="ml-2 text-[10px] uppercase text-muted-foreground">{c.role}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={!userId || submitting || noCandidates}>
            {submitting && <Loader2 className="mr-1 size-4 animate-spin" />}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
