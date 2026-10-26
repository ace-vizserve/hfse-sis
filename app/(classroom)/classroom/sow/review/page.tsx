import { redirect } from 'next/navigation';

import { ReviewQueueTable } from '@/components/sow/review-queue-table';
import { PageShell } from '@/components/ui/page-shell';
import { listSowReviewQueue } from '@/lib/sow/review';
import { createServiceClient } from '@/lib/supabase/service';
import { getSessionUser } from '@/lib/supabase/server';

// Schemes to review — "Waiting for you". Open to anyone in Classroom: the
// list is scoped to the steps that name the reader (`listSowReviewQueue`), so
// somebody on no step sees the empty state rather than a bounce.
//
// Read through the service client after the session check: the scoping is the
// inbox's pool test, and the SOW tables have no staff read policy of their own.

export default async function SchemesToReviewPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const rows = await listSowReviewQueue(createServiceClient(), {
    userId: user.id,
    role: user.role,
  });

  return (
    <PageShell>
      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Classroom · Schemes of work
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Waiting for you.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Schemes of work at a step you are on, longest waiting first. Open one
          to read its weeks, then vet or approve it, or return it to the teacher
          with a note.
        </p>
      </header>

      <ReviewQueueTable rows={rows} />
    </PageShell>
  );
}
