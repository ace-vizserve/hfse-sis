'use client';

import { useState } from 'react';
import { Wrench } from 'lucide-react';

import { SubjectLevelTree } from '@/components/sis/subject-level-tree';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

// Reachable, but deliberately out of the way — a quiet text-style trigger
// rather than a tab-bar-lookalike control, so the page reads as one thing
// (set the catalog up, put it in front of sections) with an escape hatch
// for the rare per-individual-level case, not two co-equal choices.
export function AdvancedSubjectViewSheet(
  props: React.ComponentProps<typeof SubjectLevelTree>
) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto gap-1.5 px-0 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Wrench className="size-3.5" />
        Need control over one specific level? Advanced view
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-3xl"
        >
          <SheetHeader>
            <SheetTitle>Advanced — drag &amp; drop by level</SheetTitle>
            <SheetDescription>
              Attach a subject to one individual level at a time, or review the
              Structure Defaults template. Most setup work doesn&apos;t need
              this — it&apos;s here for the exceptions.
            </SheetDescription>
          </SheetHeader>
          <div className="px-1 py-5">
            <SubjectLevelTree {...props} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
