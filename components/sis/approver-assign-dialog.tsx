'use client';

import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ApproverFlow } from '@/lib/schemas/approvers';

type Candidate = { user_id: string; email: string; role: string };

type Props = {
  flow: ApproverFlow;
  flowLabel: string;
  candidates: Candidate[];
};

export function ApproverAssignDialog({ flow, flowLabel, candidates }: Props) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');

  const assignMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ alreadyAssigned?: boolean }>(
        '/api/sis/admin/approvers',
        jsonInit('POST', { user_id: userId, flow })
      ),
  });

  const run = useWriteAction();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    if (!userId) return;
    setSubmitting(true);
    await run(() => assignMutation.mutateAsync(), {
      pending: 'Assigning approver…',
      // "Already assigned" is a no-op, not an achievement — it keeps its own
      // neutral tone rather than being reported as a change that happened.
      success: (body) => {
        if (body.alreadyAssigned) {
          toast.info('User is already assigned to this flow');
          return null;
        }
        return 'Approver assigned';
      },
      error: (e) =>
        e instanceof Error ? e.message : 'Failed to assign approver',
      onResolved: () => {
        setOpen(false);
        setUserId('');
      },
    });
    setSubmitting(false);
  }

  const noCandidates = candidates.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setUserId('');
        }
      }}
    >
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
            Assigned users will see change requests from teachers in their admin
            inbox and receive the notification email when a new request is
            filed.
          </DialogDescription>
        </DialogHeader>
        {noCandidates ? (
          <p className="text-sm text-muted-foreground">
            Every admin and superadmin is already assigned to this flow.
          </p>
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
                    <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                      {c.role}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void onSubmit()}
            loading={submitting}
            loadingText="Assigning…"
            disabled={!userId || noCandidates}
          >
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
