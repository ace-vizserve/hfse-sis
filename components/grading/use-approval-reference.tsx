'use client';

import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function useApprovalReference() {
  const [approvalRef, setApprovalRef] = useState<string>('');
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const pending = useRef<((ref: string | null) => void) | null>(null);

  function resolvePending(value: string | null) {
    const fn = pending.current;
    pending.current = null;
    fn?.(value);
  }

  async function requireApproval(): Promise<string | null> {
    if (approvalRef) return approvalRef;
    setInput('');
    setOpen(true);
    return new Promise<string | null>((resolve) => {
      pending.current = resolve;
    });
  }

  function confirm() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setApprovalRef(trimmed);
    setOpen(false);
    resolvePending(trimmed);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resolvePending(null);
  }

  const dialog = (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approval reference required</DialogTitle>
          <DialogDescription>
            This sheet is locked. Enter the approval reference for this change — it will be
            appended to the audit log.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="approval-reference">Approval reference</FieldLabel>
          <Input
            id="approval-reference"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='e.g. "Email from Ms. Chandana, 2026-03-15"'
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirm();
              }
            }}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!input.trim()}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { requireApproval, dialog };
}
