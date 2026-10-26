import { Eye } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ReviewQueueTable } from '@/components/sow/review-queue-table';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/ui/page-shell';
import { resolveOversightScope } from '@/lib/sow/oversight';
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

  const service = createServiceClient();
  const [rows, scope] = await Promise.all([
    listSowReviewQueue(service, { userId: user.id, role: user.role }),
    resolveOversightScope(service, user.id, user.role),
  ]);

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Classroom · Schemes of work
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Waiting for you.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Schemes of work at a step you are on, longest waiting first. Open
            one to read its weeks, then vet or approve it, or return it to the
            teacher with a note.
          </p>
        </div>
        {/* Subject heads and approvers reach oversight from here: the
            sidebar lists it for the office only (lib/auth/roles.ts). */}
        {scope && (
          <Button variant="outline" asChild>
            <Link href="/classroom/sow/oversight">
              <Eye className="size-4" />
              Scheme of work oversight
            </Link>
          </Button>
        )}
      </header>

      <ReviewQueueTable rows={rows} />
    </PageShell>
  );
}
