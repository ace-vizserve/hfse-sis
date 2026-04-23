import { redirect } from 'next/navigation';

// FCA comments moved to the Evaluation module (2026-04-22, KD #49). This
// stub redirects legacy deep links to `/evaluation/sections/[id]`, which
// owns the same field sourced from `evaluation_writeups` instead of the
// legacy `report_card_comments` table. `?term_id=` is preserved so the
// target page lands on the right term.
export default async function LegacyMarkbookSectionCommentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ term_id?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = sp.term_id ? `?term_id=${encodeURIComponent(sp.term_id)}` : '';
  redirect(`/evaluation/sections/${encodeURIComponent(id)}${qs}`);
}
