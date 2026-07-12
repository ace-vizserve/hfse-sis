// Extracted verbatim from report-card-document.tsx (T4 3-column adviser/
// principal/CEO block vs interim single Parent's Signature block) so a
// School Config live preview (Phase 5, Task 12) can render EXACTLY what
// prints, never a re-derived approximation that could drift.

export function ReportCardSignatureBlock({
  isFinal,
  formClassAdviser,
  principalName,
  ceoName,
}: {
  isFinal: boolean;
  formClassAdviser: string | null;
  principalName: string;
  ceoName: string;
}) {
  return (
    <section className="pt-2 text-xs text-ink-3 print:break-inside-avoid">
      {isFinal ? (
        <div className="grid grid-cols-3 gap-6 sm:gap-8">
          <div>
            <div className="h-12 border-b border-ink-5"></div>
            <p className="mt-2 font-medium text-ink">
              {formClassAdviser ?? 'Form Teacher'}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-ink-4">
              Form Teacher
            </p>
          </div>
          <div>
            <div className="h-12 border-b border-ink-5"></div>
            <p className="mt-2 font-medium text-ink">{principalName || ' '}</p>
            <p className="text-[10px] uppercase tracking-wider text-ink-4">
              School Principal
            </p>
          </div>
          <div>
            <div className="h-12 border-b border-ink-5"></div>
            <p className="mt-2 font-medium text-ink">{ceoName || ' '}</p>
            <p className="text-[10px] uppercase tracking-wider text-ink-4">
              Founder &amp; CEO
            </p>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-xs">
          <div className="h-12 border-b border-ink-5"></div>
          <p className="mt-2 text-center font-medium text-ink">&nbsp;</p>
          <p className="text-center text-[10px] uppercase tracking-wider text-ink-4">
            Parent&apos;s Signature
          </p>
        </div>
      )}
    </section>
  );
}
