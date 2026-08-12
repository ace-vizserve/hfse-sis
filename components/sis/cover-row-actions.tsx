'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
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
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * The two things you do to a cover that is already running: hand it to someone
 * else, or end it.
 *
 * NEITHER IS DESTRUCTIVE, so neither uses AlertDialog. Ending cover writes an
 * end date on a row that stays; changing the substitute closes one stretch and
 * opens another, so both people remain on the record. Nothing is deleted, and a
 * confirm styled as a warning would misrepresent what is about to happen.
 */
export function CoverRowActions({
  reliefId,
  assignmentId,
  classLabel,
  currentSubstituteName,
  currentReason,
  teacherOptions,
  canManage,
}: {
  reliefId: string;
  assignmentId: string;
  classLabel: string;
  currentSubstituteName: string;
  currentReason: string;
  teacherOptions: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [changeOpen, setChangeOpen] = useState(false);
  const [nextTeacher, setNextTeacher] = useState('');

  const end = useMutation({
    mutationFn: () =>
      apiFetch(`/api/assignment-reliefs/${reliefId}/end`, jsonInit('PATCH')),
    onSuccess: () => {
      toast.success(
        `${currentSubstituteName} is no longer covering ${classLabel}.`
      );
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Change = end the current stretch, then start a new one. Sequential on
  // purpose: the unique index allows only one running cover per class, so the
  // old one has to close before the new one can open.
  const change = useMutation({
    mutationFn: async () => {
      await apiFetch(
        `/api/assignment-reliefs/${reliefId}/end`,
        jsonInit('PATCH')
      );
      return apiFetch<{ count: number }>(
        '/api/assignment-reliefs',
        jsonInit('POST', {
          reason: currentReason,
          covers: [
            {
              assignment_id: assignmentId,
              relief_teacher_user_id: nextTeacher,
            },
          ],
        })
      );
    },
    onSuccess: () => {
      toast.success(`Cover for ${classLabel} handed over.`);
      setChangeOpen(false);
      setNextTeacher('');
      router.refresh();
    },
    onError: (err: Error) =>
      toast.error(
        // The handover is two steps and the first may have succeeded. Say so,
        // rather than letting the admin assume nothing happened.
        `${err.message} The previous cover may already have been ended — check the list before trying again.`
      ),
  });

  if (!canManage) return null;

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog
        open={changeOpen}
        onOpenChange={(next) => {
          setChangeOpen(next);
          if (!next) setNextTeacher('');
        }}
      >
        <Button variant="ghost" onClick={() => setChangeOpen(true)}>
          Change who covers
        </Button>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">
              Hand this class over
            </DialogTitle>
            <DialogDescription>
              {classLabel} — {currentSubstituteName} is covering it now.
            </DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel htmlFor="cover-next">Hand over to</FieldLabel>
            <Select value={nextTeacher} onValueChange={setNextTeacher}>
              <SelectTrigger id="cover-next">
                <SelectValue placeholder="Choose a teacher" />
              </SelectTrigger>
              <SelectContent>
                {teacherOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {currentSubstituteName}&apos;s stretch is closed today and the new
              one starts today. Both stay on the record, so it is clear who ran
              the class in which week.
            </p>
          </Field>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => change.mutate()}
              disabled={!nextTeacher || change.isPending}
            >
              {change.isPending && <Loader2 className="size-4 animate-spin" />}
              Hand over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button
        variant="outline"
        onClick={() => end.mutate()}
        disabled={end.isPending}
      >
        {end.isPending && <Loader2 className="size-4 animate-spin" />}
        End cover
      </Button>
    </div>
  );
}
