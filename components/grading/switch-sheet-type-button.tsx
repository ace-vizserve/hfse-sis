'use client';

import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  SHEET_TYPE_LABEL,
  type SheetType,
} from '@/lib/grading/term4-framework';

// "Switch to Term 4 framework" / "Switch to Standard" on the sheet itself
// (KD #230 update, Mr Ace 2026-10-08). A sheet becomes a Term 4 framework
// sheet only this way, and goes back the same way. The page renders it for an
// oversight viewer on an unlocked sheet; the database re-checks everything
// (migration 185). Same small confirm as "Remove sheet".
export function SwitchSheetTypeButton({
  sheetId,
  to,
  studentsWithScores,
  onDone,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  /** Ran after the type actually changed — see `LockToggle`'s `onDone`. */
  onDone?: () => void;
  /** Controlled confirm, for a host that raises it from a menu item. */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  /** Render no button — the host opens the confirm itself. */
  hideTrigger?: boolean;
  sheetId: string;
  /** The type the sheet switches TO. */
  to: SheetType;
  /** Students with a score a person entered — what the switch clears. */
  studentsWithScores: number;
}) {
  const run = useWriteAction();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [busy, setBusy] = useState(false);

  const action = `Switch to ${SHEET_TYPE_LABEL[to]}`;
  const toFramework = to === 'term4_framework';

  async function doSwitch() {
    setBusy(true);
    const result = await run(
      () =>
        apiFetch(
          `/api/grading-sheets/${sheetId}/sheet-type`,
          jsonInit('PATCH', { sheet_type: to })
        ),
      {
        pending: 'Switching sheet type…',
        success: `Switched to ${SHEET_TYPE_LABEL[to]}`,
      }
    );
    setBusy(false);
    if (result !== undefined) onDone?.();
  }

  const scoresLine =
    studentsWithScores === 0
      ? 'No scores have been entered yet, so nothing is cleared.'
      : `Scores already entered for ${studentsWithScores} ${
          studentsWithScores === 1 ? 'student' : 'students'
        } are cleared from the sheet. They stay in the activity log.`;

  return (
    <>
      {!hideTrigger && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          loading={busy}
          loadingText="Switching…"
          onClick={() => setOpen(true)}
        >
          {!busy && <ArrowLeftRight className="h-4 w-4" />}
          {action}
        </Button>
      )}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{action}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {toFramework
                    ? 'The sheet gets the Term 4 framework columns: best term average (50%), teacher’s recommendation out of 30 (20%) and revision task or mock exam out of 100 (30%).'
                    : 'The sheet goes back to standard columns: three written works and three performance tasks out of 10 each, and the exam, with the subject’s usual weights.'}
                </p>
                <p>{scoresLine}</p>
                <p>
                  {toFramework
                    ? 'Each student’s best term average fills in automatically.'
                    : 'The best term average is taken off the sheet.'}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it as it is</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doSwitch()}>
              {action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
