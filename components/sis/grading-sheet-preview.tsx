'use client';

// Renders the ACTUAL grading-sheet columns a teacher would see (WW/PT slot
// count + QA denominator) for a subject's config — a small artifact-preview
// so an admin editing slot counts can see the shape they're producing, not
// just abstract numbers. Extracted from the old subject-config-matrix.tsx
// (pre subject-weights-tree rebuild) into its own file so both the weights
// edit dialog and the tree can import it without a circular dependency
// between the two.
export function GradingSheetPreview({
  config,
}: {
  config: { ww_max_slots: number; pt_max_slots: number; qa_max: number };
}) {
  return (
    <div className="flex gap-1 overflow-x-auto py-1">
      {Array.from({ length: config.ww_max_slots }, (_, i) => (
        <div key={`ww${i}`} className="w-11 flex-none text-center">
          <div className="rounded-t-md bg-brand-sky/15 py-1 font-mono text-[10px] font-semibold uppercase text-brand-indigo-deep">
            WW{i + 1}
          </div>
          <div className="rounded-b-md border border-t-0 border-border bg-card py-1 font-mono text-[10px] text-ink-3">
            /10
          </div>
        </div>
      ))}
      <div className="w-2 flex-none" aria-hidden />
      {Array.from({ length: config.pt_max_slots }, (_, i) => (
        <div key={`pt${i}`} className="w-11 flex-none text-center">
          <div className="rounded-t-md bg-brand-mint/20 py-1 font-mono text-[10px] font-semibold uppercase text-ink">
            PT{i + 1}
          </div>
          <div className="rounded-b-md border border-t-0 border-border bg-card py-1 font-mono text-[10px] text-ink-3">
            /10
          </div>
        </div>
      ))}
      <div className="w-2 flex-none" aria-hidden />
      <div className="w-12 flex-none text-center">
        <div className="rounded-t-md bg-brand-amber-light py-1 font-mono text-[10px] font-semibold uppercase text-brand-amber">
          QA
        </div>
        <div className="rounded-b-md border border-t-0 border-border bg-card py-1 font-mono text-[10px] text-ink-3">
          /{config.qa_max}
        </div>
      </div>
    </div>
  );
}
