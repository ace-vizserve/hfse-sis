'use client';

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
import type { MovePreview } from '@/lib/billing/settings-helpers';

export type PreviewResult = MovePreview & { tilesSkipped: string | null };

const part = (n: number, word: string) => (n ? `${n} ${word}` : null);

// "What would change" before a Billing settings save (spec todo, 2026-10-15).
// Shows the moves per year and tile; nothing is saved until Save is pressed.
export function ChangePreviewDialog({
  preview,
  onCancel,
  onConfirm,
}: {
  preview: PreviewResult | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={!!preview} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {preview && preview.invoices > 0
              ? `${preview.invoices} invoices move, for ${preview.students} students`
              : 'No invoice moves'}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              {preview && preview.byYear.length > 0 && (
                <ul className="space-y-1.5">
                  {preview.byYear.map((y) => {
                    const reg = [
                      part(y.registration.gain, 'added'),
                      part(y.registration.lose, 'removed'),
                    ]
                      .filter(Boolean)
                      .join(', ');
                    const fees = [
                      part(y.fees.gain, 'added'),
                      part(y.fees.lose, 'removed'),
                    ]
                      .filter(Boolean)
                      .join(', ');
                    return (
                      <li key={y.ayCode} className="text-foreground">
                        <span className="font-mono text-[12px] font-semibold">
                          {y.ayCode}
                        </span>
                        {reg && <span> · Registration: {reg}</span>}
                        {fees && <span> · Fees: {fees}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p>
                {preview?.tilesSkipped
                  ? preview.tilesSkipped
                  : 'The Registration and Fees stages of those students are then worked out again. A number staff typed by hand is never cleared.'}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Save</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
