import { redirect } from 'next/navigation';

// Adviser comments moved to the Evaluation module (2026-04-22, KD #49).
// `[id]` was the section id; target is `/evaluation/sections/[id]`.
// `?term_id=` preserved.
export default async function LegacyAdvisoryCommentsPage({
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
